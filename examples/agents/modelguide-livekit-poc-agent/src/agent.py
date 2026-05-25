"""POC LiveKit voice agent — dashboard-driven prompt, no tools.

What this demonstrates:

  1. On every session, the worker fetches the agent's compiled prompt from
     ModelGuide via ``GET /api/agents/me/runtime-config``.  No prompt is
     baked into this image.
  2. "Sync" from the dashboard is the existing Compile action — once the
     compiled prompt lands in the DB, the very next "Talk to agent" click
     uses it.  No redeploy, no dispatch-metadata round-trip.
  3. The flow is platform-agnostic: any STT/LLM/TTS combo works because
     instructions are the only piece sourced from the dashboard.

What this deliberately does NOT do:

  - No MCP / tool execution.  The point is the prompt-sync loop; tool
    orchestration is covered by ``examples/agents/livekit-agent``.
  - No SIP / phone telephony.  WebRTC voice-test only.
  - No outbound dispatch.  Inbound rooms only.

See ADR-015 and the README.
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """Per-room entrypoint — runs once per dispatched voice-test session."""
    config.validate()
    logger.info("ModelGuide POC agent v%s — entrypoint called", VERSION)

    await ctx.connect()

    # Fetch the dashboard's latest compiled prompt and create a ModelGuide
    # session in parallel — both hit the same API and shouldn't serialize.
    runtime_task = asyncio.create_task(mg_client.fetch_runtime_config())
    session_task = asyncio.create_task(mg_client.create_session("voice-test"))
    participant_task = asyncio.create_task(ctx.wait_for_participant())

    runtime_cfg = await runtime_task
    session_id = await session_task
    participant = await participant_task

    logger.info(
        "Booting session: agent=%s slug=%s session=%s participant=%s",
        runtime_cfg.id,
        runtime_cfg.slug,
        session_id,
        participant.identity,
    )

    # Build the LiveKit Agent with whatever the dashboard says today.
    voice_agent = Agent(instructions=runtime_cfg.resolved_instructions())

    session = AgentSession(
        stt=deepgram.STT(model=config.STT_MODEL, api_key=config.DEEPGRAM_API_KEY),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            api_key=config.ELEVENLABS_API_KEY,
            voice_id=config.ELEVENLABS_VOICE_ID,
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    done = asyncio.Event()

    @session.on("close")
    def _on_close() -> None:
        done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect() -> None:
        done.set()

    await session.start(room=ctx.room, agent=voice_agent)

    # Greet so the caller hears the agent immediately — distinguishes
    # "compiled prompt loaded" from "compiled prompt missing" without
    # waiting for the operator to speak first.
    if runtime_cfg.compiled_instructions:
        await session.say(f"Connected. {runtime_cfg.name} is listening.")
    else:
        await session.say(config.FALLBACK_GREETING)

    try:
        await done.wait()
    finally:
        if session_id:
            await mg_client.complete_session(session_id)
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
