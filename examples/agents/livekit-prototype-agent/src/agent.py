"""Prototype LiveKit voice agent for ModelGuide.

What's special about this worker compared to ``examples/agents/livekit-agent``:
it has no hardcoded system prompt. On every session start the worker calls
``GET /api/agents/runtime-config`` on the ModelGuide API using its scoped API
key and builds the LiveKit ``Agent`` from the returned ``compiledInstructions``.

That single round-trip is what makes the dashboard's "compile prompt → click
Talk to agent" loop work end-to-end without a worker redeploy.

CLI usage:
    python src/agent.py console   # text-only smoke test, no WebRTC
    python src/agent.py dev       # full WebRTC, dispatch via the dashboard
    python src/agent.py start     # production worker
"""

from __future__ import annotations

import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
from runtime_config import (
    RuntimeConfigError,
    build_system_instructions,
    close_http_client,
    fetch_runtime_config,
)

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")

GREETING = "Hi! How can I help you today?"


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit agent entrypoint — runs once per dispatched room."""
    config.validate()

    # Pull the latest compiled prompt before doing anything else. Failing here
    # is preferable to silently using a stale or empty prompt — the operator
    # would otherwise spend time wondering why "talk to agent" doesn't reflect
    # the prompt they just compiled.
    try:
        runtime = await fetch_runtime_config(
            api_url=config.MODELGUIDE_API_URL,
            api_key=config.MODELGUIDE_API_KEY,
        )
    except RuntimeConfigError:
        logger.exception(
            "Failed to fetch runtime config from %s — aborting session",
            config.MODELGUIDE_API_URL,
        )
        return

    instructions = build_system_instructions(runtime, fallback=config.FALLBACK_PROMPT)
    logger.info(
        "Runtime config loaded for %s (compiled_at=%s, instructions=%d chars)",
        runtime.slug,
        runtime.compiled_at,
        len(instructions),
    )

    await ctx.connect()
    await ctx.wait_for_participant()

    agent = Agent(instructions=instructions)

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", api_key=config.DEEPGRAM_API_KEY),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.ELEVENLABS_VOICE_ID,
            api_key=config.ELEVENLABS_API_KEY,
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    await session.start(room=ctx.room, agent=agent)
    await session.say(GREETING)

    @ctx.room.on("disconnected")
    def _on_disconnected() -> None:
        logger.info("Room disconnected — cleaning up")

    ctx.add_shutdown_callback(close_http_client)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
