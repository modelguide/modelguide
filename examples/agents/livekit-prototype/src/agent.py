"""Prototype LiveKit voice agent — runtime prompt + MCP-tool fetch.

This worker is intentionally minimal. Unlike ``examples/agents/livekit-agent``
(BuildPro Sam), which bakes its system prompt and tool wiring into the worker
image, this prototype fetches both from ModelGuide at session start:

  1. ``GET /api/agents/me`` → compiled instructions (the system prompt)
  2. ``ListTools`` on the agent's MCP endpoint → tool catalog
  3. The LLM is given those tools dynamically — every connector tool the
     operator has wired up in the dashboard shows up here automatically.

Trade-off vs the BuildPro worker: see ADR-015. Short version — drift-in-
testing risk vs. dramatically faster iteration when an operator wants to
hear how a freshly-compiled prompt sounds.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from livekit import agents
from livekit.agents import Agent, AgentSession, RunContext, function_tool
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_prompt
from mg_mcp import MCPClient, MCPTool, build_tool_description
from providers import create_stt, create_tts

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("prototype")


# ---------------------------------------------------------------------------
# Dynamic tool wiring
# ---------------------------------------------------------------------------


def _build_dynamic_tools(
    tools: list[MCPTool],
    mcp: MCPClient,
    session_id_provider,
):
    """Wrap each MCP tool in a LiveKit ``@function_tool`` so the LLM sees it.

    LiveKit's decorator inspects the wrapped coroutine's signature for
    parameter introspection. Since MCP tools have JSON-schema args (not
    Python signatures), we use a single ``args: dict`` parameter and lean
    on the tool's *description* (which the API embeds the input schema
    into) to teach the LLM how to call it. This is the trade-off the
    prototype makes for "any tool the operator wires up shows up" — a
    production worker would generate typed wrappers per tool from the
    schema instead.
    """
    wrapped = []
    for tool in tools:
        # Closure-capture the tool name so each wrapper calls the right one.
        description = build_tool_description(tool)

        async def _impl(
            context: RunContext,
            arguments: dict[str, Any],
            *,
            _name: str = tool.name,
        ) -> str:
            try:
                result = await mcp.call_tool(
                    _name, arguments, session_id_provider()
                )
                return json.dumps(result)
            except Exception as exc:
                logger.exception("Tool %s failed", _name)
                raise agents.ToolError(f"Tool {_name} failed: {exc}") from exc

        # The decorator uses the wrapper's __name__ as the tool name, so
        # set it before decorating.
        _impl.__name__ = tool.name
        _impl.__doc__ = description
        wrapped.append(function_tool()(_impl))

    return wrapped


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def entrypoint(ctx: agents.JobContext):
    """Called once per LiveKit room. The prototype's one trick is between
    ``await ctx.connect()`` and ``await session.start()`` below — that's
    where the runtime prompt + tool fetch happens."""
    config.validate()
    logger.info("%s prototype agent v%s — entrypoint", config.AGENT_NAME, VERSION)

    # Dispatch metadata is the same shape as the BuildPro worker so the
    # API's ``createVoiceTestSession`` can dispatch either worker without
    # changes. See ``buildVoiceTestDispatchMetadata`` in agents.service.ts.
    dispatch_metadata: dict = {}
    if ctx.job.metadata:
        try:
            dispatch_metadata = json.loads(ctx.job.metadata)
        except json.JSONDecodeError:
            logger.warning(
                "Invalid JSON in dispatch metadata: %s", ctx.job.metadata[:120]
            )

    session_id: str | None = dispatch_metadata.get("session_id")
    user_identifier: str = (
        dispatch_metadata.get("user_identifier")
        or dispatch_metadata.get("email")
        or "voice-caller"
    )

    await ctx.connect()

    # --- Fetch compiled prompt + MCP tool catalog in parallel ---
    # If the prompt fetch fails we still try to run with the fallback so
    # the caller hears *something*. If the MCP listing fails we run with
    # zero tools — the LLM can still hold a conversation.
    try:
        agent_self = await mg_prompt.fetch_agent_self(
            config.MODELGUIDE_API_URL, config.MODELGUIDE_API_KEY
        )
        instructions = agent_self.compiled_instructions
        agent_id = agent_self.id
        logger.info(
            "Loaded compiled prompt from ModelGuide (compiledAt=%s, length=%d)",
            agent_self.compiled_at,
            len(instructions),
        )
    except mg_prompt.MissingCompiledPrompt as exc:
        logger.warning("No compiled prompt — using fallback (%s)", exc)
        instructions = config.FALLBACK_INSTRUCTIONS
        # Without /me we don't have an agent ID — skip MCP entirely.
        agent_id = None
    except Exception:
        logger.exception("Prompt fetch failed — using fallback instructions")
        instructions = config.FALLBACK_INSTRUCTIONS
        agent_id = None

    # --- MCP: list + wrap tools (only if we got a real agent_id) ---
    mcp: MCPClient | None = None
    dynamic_tools = []
    if agent_id:
        try:
            mcp = MCPClient(
                config.MODELGUIDE_API_URL,
                agent_id,
                config.MODELGUIDE_API_KEY,
            )
            await mcp._connect()
            tools = await mcp.list_tools()
            logger.info(
                "Discovered %d MCP tool(s): %s",
                len(tools),
                ", ".join(t.name for t in tools) or "(none)",
            )
            dynamic_tools = _build_dynamic_tools(
                tools, mcp, lambda: session_id
            )
        except Exception:
            logger.exception(
                "MCP discovery failed — running with zero tools"
            )

    # Wait for the human participant (browser caller) before we start
    # the LLM — this matches the BuildPro flow.
    participant = await ctx.wait_for_participant()
    logger.info(
        "Participant joined: %s (user_identifier=%s, session_id=%s)",
        participant.identity,
        user_identifier,
        session_id,
    )

    agent = Agent(instructions=instructions, tools=dynamic_tools)

    session = AgentSession(
        stt=create_stt(),
        llm=openai.LLM(
            model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY
        ),
        tts=create_tts(),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close():
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect():
        session_done.set()

    await session.start(room=ctx.room, agent=agent)

    # Brief greeting so the caller knows we're connected
    name = participant.name or "there"
    await session.say(
        f"Hi {name}. I'm the prototype agent. How can I help you?"
    )

    try:
        await session_done.wait()
    finally:
        if mcp is not None:
            await mcp.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
