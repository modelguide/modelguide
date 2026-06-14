"""LiveKit voice agent entrypoint for the voiceblox prototype.

Usage:
  python src/agent.py console       (text-only, no WebRTC)
  python src/agent.py dev           (full WebRTC, local LiveKit)
  python src/agent.py start         (production worker)
  python src/agent.py download-files

What's different from buildpro:
- No connector tools wired in. This POC is prompt-only.
- The system prompt is pulled from ModelGuide at session start via
  GET /api/agents/me, so admins can recompile and immediately retest
  without redeploying the worker.
- No SIP / phone-number plumbing. Browser WebRTC only.
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
from providers import create_stt, create_tts
from voiceblox_agent import build_greeting, resolve_system_prompt

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    config.validate()
    logger.info("%s agent v%s — entrypoint called", config.AGENT_NAME, VERSION)

    # Resolve the system prompt BEFORE connecting — that way the prompt cache
    # warmup below already has the right instructions to hash against.
    prompt, source = await resolve_system_prompt()
    logger.info("Prompt source: %s (%d chars)", source, len(prompt))

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # Create a ModelGuide session so the call shows up in the dashboard.
    user_identifier = participant.name or participant.identity or "voice-caller"
    session_id: str | None = None
    try:
        session_id = await mg_client.create_session(user_identifier)
    except Exception:
        logger.exception("create_session failed — running without tracking")

    voice_agent = Agent(instructions=prompt)
    session = AgentSession(
        stt=create_stt(),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=create_tts(),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close() -> None:
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect() -> None:
        session_done.set()

    await session.start(room=ctx.room, agent=voice_agent)
    await session.say(build_greeting({"name": config.AGENT_NAME}))

    try:
        await session_done.wait()
    finally:
        if session_id:
            try:
                await mg_client.complete_session(session_id)
            except Exception:
                logger.exception("complete_session failed for %s", session_id)
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
