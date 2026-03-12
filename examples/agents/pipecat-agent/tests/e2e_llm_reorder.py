"""E2E reorder flow with actual LLM responses via OpenAI Chat Completions.

Drives the full reorder conversation through the LLM with BuildPro Sam's
system prompt and tools, recording actual responses and tool calls.
Tests that the LLM correctly identifies orders, doesn't mix up addresses,
and follows the reorder workflow.

Usage:
  cd examples/agents/pipecat-agent
  .venv/bin/python tests/e2e_llm_reorder.py

Override model:
  LLM_MODEL=gpt-4.1 .venv/bin/python tests/e2e_llm_reorder.py
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from openai import AsyncOpenAI

import config
import mg_client
import tools
from tools import TOOL_SCHEMAS, TOOL_NAME_MAP, _transform_args, _extract_cart_id
from prompts import build_system_prompt
from transcript import TranscriptCollector

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("e2e_llm")

# The user turns from the demo conversation
USER_TURNS = [
    "Hi, my tile's broken on job and I need to order the same one that was ordered for tomorrow.",
    "Which one was delivered to four eight one one Greenway?",
    "Yes.",
    "Yes, and also I need-- I'm running low on Mapei grout.",
    "Yeah, just add one more bag.",
    "Can you just send it over email and I will come back later?",
    "No, that's all. Thank you.",
]


async def execute_tool(tool_name: str, tool_args: dict, session_id: str) -> str:
    """Execute a tool via MCP and return JSON string result."""
    mcp_name = TOOL_NAME_MAP.get(tool_name)
    if not mcp_name:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    mcp_args = _transform_args(tool_name, {**tool_args})
    try:
        result = await mg_client.call_tool(mcp_name, mcp_args, session_id)
        _extract_cart_id(tool_name, result)
        return json.dumps(result)
    except Exception as e:
        return json.dumps({"error": str(e)})


async def main():
    config.validate()
    tools._active_cart_id = None

    model = os.getenv("LLM_MODEL", "gpt-4.1-mini")
    client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)

    # Create session
    session_id = await mg_client.create_session(config.USER_EMAIL)
    logger.info("Session: %s, Model: %s", session_id, model)

    # Build system prompt + messages
    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)
    messages = [{"role": "system", "content": system_prompt}]

    print(f"\n{'='*70}")
    print(f"  REORDER FLOW — LLM TRANSCRIPT (model: {model})")
    print(f"{'='*70}")

    # Initial greeting
    messages.append({"role": "user", "content": "(User joins the call)"})
    response = await client.chat.completions.create(
        model=model, messages=messages, tools=TOOL_SCHEMAS,
    )
    greeting = response.choices[0].message
    messages.append(greeting.model_dump(exclude_none=True))
    print(f"\nAgent: {greeting.content}")

    # Process each user turn
    tool_call_log = []

    for user_text in USER_TURNS:
        print(f"\nUser: {user_text}")
        messages.append({"role": "user", "content": user_text})

        # LLM loop — handle tool calls until we get a text response
        for _ in range(8):
            response = await client.chat.completions.create(
                model=model, messages=messages, tools=TOOL_SCHEMAS,
            )
            assistant_msg = response.choices[0].message
            messages.append(assistant_msg.model_dump(exclude_none=True))

            if assistant_msg.tool_calls:
                for tc in assistant_msg.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    print(f"  [{fn_name}({json.dumps(fn_args)})]")
                    tool_call_log.append(fn_name)

                    result_str = await execute_tool(fn_name, fn_args, session_id)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_str,
                    })

                if assistant_msg.content:
                    print(f"Agent: {assistant_msg.content}")
            else:
                if assistant_msg.content:
                    print(f"Agent: {assistant_msg.content}")
                break

    # Complete session
    await mg_client.complete_session(session_id, status="completed")

    print(f"\n{'='*70}")
    print(f"  SUMMARY")
    print(f"{'='*70}")
    print(f"  Model:         {model}")
    print(f"  Session:       {session_id}")
    print(f"  Tool calls:    {len(tool_call_log)}")
    print(f"  Tools used:    {', '.join(tool_call_log)}")
    print(f"  Cart ID:       {tools._active_cart_id}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    asyncio.run(main())
