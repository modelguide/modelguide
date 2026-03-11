"""E2E reorder flow with actual LLM responses via OpenAI Chat Completions.

Drives the full reorder conversation through the OpenAI API with BuildPro Sam's
system prompt and tools, recording the LLM's actual responses and tool calls.

Usage:
  uv run python tests/e2e_llm_reorder.py
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from openai import AsyncOpenAI

import config
import mg_client
from agent import BuildProAgent, TOOL_NAME_MAP
from prompts import build_system_prompt
from transcript import TranscriptCollector

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("e2e_llm")

# The user turns from the demo conversation
USER_TURNS = [
    "Hi, my tile's broken on job and I need to order the same one that was ordered for tomorrow.",
    "Which one was delivered to four eight one one Greenway?",
    "Yes.",
    "Yes, and also I need-- I'm running some, mm, Mapei grout.",
    "Yeah, just add one more bag.",
    "Can you just send it over email and I will come back later?",
    "No, that's all. Thank you.",
]


def build_openai_tools():
    """Build OpenAI function tool schemas from the agent's @function_tool methods."""
    tools = []
    for short_name, mcp_name in TOOL_NAME_MAP.items():
        # Match schemas from pipecat's TOOL_SCHEMAS
        schema = _TOOL_PARAM_SCHEMAS.get(short_name, {"type": "object", "properties": {}, "required": []})
        tools.append({
            "type": "function",
            "function": {
                "name": short_name,
                "description": _TOOL_DESCRIPTIONS.get(short_name, ""),
                "parameters": schema,
            },
        })
    return tools


# Tool descriptions and param schemas (same as pipecat's TOOL_SCHEMAS)
_TOOL_DESCRIPTIONS = {
    "list_products": "Search for products in the catalog. Returns product names, prices, and IDs.",
    "get_product": "Get detailed information about a specific product by ID.",
    "create_cart": "Create a new shopping cart for the customer.",
    "add_to_cart": "Add a product to the shopping cart. Cart ID is managed automatically.",
    "get_cart": "View the current cart contents and total.",
    "set_delivery_address": "Set the delivery address for the order.",
    "complete_cart": "Complete the order and place it. Always confirm with the customer first.",
    "get_order": "Get details of an existing order by order ID.",
    "look_up_order_history": "Look up a customer's order history by email address.",
    "send_email": "Send an email to the customer (e.g. order confirmation, follow-up).",
}

_TOOL_PARAM_SCHEMAS = {
    "list_products": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query for products"},
            "limit": {"type": "integer", "description": "Max results (default: 20)"},
        },
        "required": [],
    },
    "get_product": {
        "type": "object",
        "properties": {"productId": {"type": "string", "description": "The product ID"}},
        "required": ["productId"],
    },
    "create_cart": {
        "type": "object",
        "properties": {"email": {"type": "string", "description": "Customer email"}},
        "required": [],
    },
    "add_to_cart": {
        "type": "object",
        "properties": {
            "variantId": {"type": "string", "description": "Variant ID to add"},
            "quantity": {"type": "integer", "description": "Number of items"},
        },
        "required": ["variantId", "quantity"],
    },
    "get_cart": {"type": "object", "properties": {}, "required": []},
    "set_delivery_address": {
        "type": "object",
        "properties": {
            "firstName": {"type": "string"}, "lastName": {"type": "string"},
            "address1": {"type": "string"}, "city": {"type": "string"},
            "postalCode": {"type": "string"}, "countryCode": {"type": "string"},
            "phone": {"type": "string"},
        },
        "required": ["address1", "city", "postalCode", "countryCode"],
    },
    "complete_cart": {"type": "object", "properties": {}, "required": []},
    "get_order": {
        "type": "object",
        "properties": {"orderId": {"type": "string", "description": "The order ID"}},
        "required": ["orderId"],
    },
    "look_up_order_history": {
        "type": "object",
        "properties": {"email": {"type": "string", "description": "Customer email"}},
        "required": ["email"],
    },
    "send_email": {
        "type": "object",
        "properties": {
            "to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"},
        },
        "required": ["to", "subject", "body"],
    },
}


async def main():
    config.validate()

    # Create session
    session_id = await mg_client.create_session(config.USER_EMAIL)
    logger.info("Session: %s", session_id)

    # Build agent for tool execution
    agent = BuildProAgent(session_id=session_id, user_email=config.USER_EMAIL)

    # Build system prompt + messages
    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)
    messages = [{"role": "system", "content": system_prompt}]
    tools = build_openai_tools()

    client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)

    print("\n" + "=" * 70)
    print("  REORDER FLOW — LLM TRANSCRIPT")
    print("=" * 70)

    # Initial greeting
    messages.append({"role": "user", "content": "(User joins the call)"})
    response = await client.chat.completions.create(
        model=config.LLM_MODEL, messages=messages, tools=tools,
    )
    greeting = response.choices[0].message
    messages.append(greeting.model_dump(exclude_none=True))
    print(f"\nAgent: {greeting.content}")

    # Process each user turn
    for user_text in USER_TURNS:
        print(f"\nUser: {user_text}")
        messages.append({"role": "user", "content": user_text})

        # LLM loop — handle tool calls until we get a text response
        max_rounds = 5
        for _ in range(max_rounds):
            response = await client.chat.completions.create(
                model=config.LLM_MODEL, messages=messages, tools=tools,
            )
            assistant_msg = response.choices[0].message
            messages.append(assistant_msg.model_dump(exclude_none=True))

            if assistant_msg.tool_calls:
                for tc in assistant_msg.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    logger.info("LLM called tool: %s(%s)", fn_name, json.dumps(fn_args, default=str))

                    # Execute via agent's MCP tool
                    try:
                        result_str = await agent._call_mcp_tool(fn_name, fn_args)
                    except Exception as e:
                        result_str = json.dumps({"error": str(e)})

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str,
                    })

                # If the assistant also had text content alongside tool calls, print it
                if assistant_msg.content:
                    print(f"Agent: {assistant_msg.content}")
            else:
                # Pure text response — print and break
                if assistant_msg.content:
                    print(f"Agent: {assistant_msg.content}")
                break

    # Post transcript
    transcript_msgs = agent._transcript.get_messages()
    if transcript_msgs:
        await mg_client.add_messages(session_id, transcript_msgs)
    await mg_client.complete_session(session_id, status="completed")

    print("\n" + "=" * 70)
    tool_calls = [m for m in transcript_msgs if "toolCalls" in m]
    print(f"  Session:       {session_id}")
    print(f"  Tool calls:    {len(tool_calls)}")
    print(f"  Cart ID:       {agent._active_cart_id}")
    if tool_calls:
        print(f"  Tools used:    {', '.join(m['toolCalls'][0]['toolName'] for m in tool_calls)}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
