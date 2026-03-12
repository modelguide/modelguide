"""Text-mode runner for rapid prompt/tool iteration without voice.

Usage:
    cd examples/agents/pipecat-agent
    .venv/bin/python src/text_runner.py

Same system prompt, tools, and MCP backend as the voice agent.
No Pipecat, no Daily, no STT/TTS.
"""

import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(override=True)

# Add src/ to path so imports work
sys.path.insert(0, os.path.dirname(__file__))

import config
from config import validate as validate_config
from prompts import build_system_prompt
from tools import TOOL_SCHEMAS, TOOL_NAME_MAP, _transform_args, _extract_cart_id
import mg_client


async def main():
    validate_config()

    client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
    model = os.getenv("LLM_MODEL", "gpt-4.1-mini")

    # Create session
    try:
        session_id = await mg_client.create_session(config.USER_EMAIL)
        print(f"[session: {session_id}]")
    except Exception as e:
        print(f"[session failed: {e}, running offline]")
        session_id = "offline"

    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)
    messages = [{"role": "system", "content": system_prompt}]

    print(f"[model: {model}]")
    print(f"[type 'quit' to exit]\n")

    # Send initial empty user message to trigger greeting
    messages.append({"role": "user", "content": "(call connected)"})
    response = await client.chat.completions.create(
        model=model, messages=messages, tools=TOOL_SCHEMAS,
    )
    msg = response.choices[0].message
    messages.append(msg)
    if msg.content:
        print(f"Sam: {msg.content}\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_input or user_input.lower() in ("quit", "exit", "q"):
            break

        messages.append({"role": "user", "content": user_input})

        # Loop to handle tool calls
        while True:
            response = await client.chat.completions.create(
                model=model, messages=messages, tools=TOOL_SCHEMAS,
            )
            msg = response.choices[0].message
            messages.append(msg)

            if not msg.tool_calls:
                if msg.content:
                    print(f"Sam: {msg.content}\n")
                break

            # Process tool calls
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                tool_args = json.loads(tc.function.arguments)
                mcp_name = TOOL_NAME_MAP.get(tool_name)

                if not mcp_name:
                    result = {"error": f"Unknown tool: {tool_name}"}
                else:
                    mcp_args = _transform_args(tool_name, {**tool_args})
                    print(f"  [{tool_name}({json.dumps(tool_args)})]")
                    try:
                        result = await mg_client.call_tool(mcp_name, mcp_args, session_id)
                        _extract_cart_id(tool_name, result)
                    except Exception as e:
                        result = {"error": str(e)}
                        print(f"  [error: {e}]")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                })

    # Cleanup
    if session_id != "offline":
        await mg_client.complete_session(session_id, status="completed")
    print("\n[done]")


if __name__ == "__main__":
    asyncio.run(main())
