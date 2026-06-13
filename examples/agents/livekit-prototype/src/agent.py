"""LiveKit voice agent prototype — pulls its system prompt from ModelGuide.

Two-line value proposition:
    1. The operator edits a prompt in the ModelGuide dashboard, clicks
       "Sync & Test", and immediately talks to the agent with the new prompt.
    2. No redeploy — the worker fetches the latest compiled prompt every
       time a room is dispatched.

Usage:
    python src/agent.py console        (text-only, no WebRTC)
    python src/agent.py dev            (full WebRTC, local LiveKit)
    python src/agent.py start          (production worker)
    python src/agent.py connect --room <name>

Most of the heavy lifting lives in the existing ``livekit-agent`` example
(workflows, cart logic, SIP). This file stays small on purpose so the
"pull-prompt-at-session-start" pattern is the only thing to read.
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
logger = logging.getLogger("prototype")


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit job entrypoint — called once per dispatched room."""
    config.validate()
    logger.info("Prototype agent v%s entrypoint — room=%s", VERSION, ctx.room.name)

    await ctx.connect()

    # Fetch latest prompt + create a session in parallel — both are independent
    # round-trips and we'd rather hit the wire concurrently than sequentially.
    runtime_cfg, session_id = await asyncio.gather(
        mg_client.fetch_runtime_config(),
        mg_client.create_session(user_identifier=config.USER_EMAIL),
        return_exceptions=False,
    )

    instructions = runtime_cfg.resolve_instructions()
    logger.info(
        "Loaded prompt for %s (compiled_at=%s, %d chars)",
        runtime_cfg.slug,
        runtime_cfg.compiled_at,
        len(instructions),
    )
    logger.info("ModelGuide session: %s", session_id)

    agent = Agent(instructions=instructions)
    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            api_key=config.DEEPGRAM_API_KEY,
            interim_results=True,
            endpointing_ms=300,
        ),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.ELEVENLABS_VOICE_ID,
            model="eleven_flash_v2_5",
            api_key=config.ELEVENLABS_API_KEY,
            inactivity_timeout=30,
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close() -> None:
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect() -> None:
        session_done.set()

    await session.start(room=ctx.room, agent=agent)
    # Speak first so callers hear something immediately — exact greeting
    # comes from the compiled prompt's persona instructions.
    await session.say("Hi — how can I help?")

    try:
        await session_done.wait()
    finally:
        try:
            await mg_client.complete_session(session_id)
        finally:
            await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint, agent_name=config.AGENT_NAME
        )
    )
