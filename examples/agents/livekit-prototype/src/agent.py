"""Prototype LiveKit voice agent — reads system prompt from dispatch metadata.

This worker is intentionally lightweight: no MCP, no SOPs, no tools, no
session-tracking callbacks. It exists to give admins a tight prompt-iteration
loop from the ModelGuide dashboard ("Compile → Talk").

Contract with the API (``buildPrototypeDispatchMetadata`` in
``modelguide-api/src/features/agents/agents.service.ts``) — see
``dispatch.py`` for the parser. The companion ADR is ``docs/decisions/
015-prototype-voice-test-with-inline-prompt.md``.

Run modes:
  python src/agent.py console       (text-only)
  python src/agent.py dev           (full WebRTC, local LiveKit)
  python src/agent.py start         (production worker — LiveKit Cloud)
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
from dispatch import DispatchError, parse_prototype_dispatch

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("prototype-agent")


class PrototypeAgent(Agent):
    """Minimal voice agent — instructions come from dispatch metadata."""

    def __init__(self, instructions: str):
        super().__init__(instructions=instructions)


async def entrypoint(ctx: agents.JobContext):
    """LiveKit entrypoint — called once per dispatched room."""
    config.validate()
    logger.info("prototype agent v%s — entrypoint called", VERSION)

    try:
        dispatch = parse_prototype_dispatch(ctx.job.metadata)
    except DispatchError as exc:
        # Surface the contract violation in the worker log and bail.
        # The room stays empty; the client-side 15s timeout will fire and
        # the dashboard will surface the connection error.
        logger.error("dispatch rejected: %s — metadata=%r", exc, ctx.job.metadata)
        return

    logger.info(
        "dispatch accepted: agent=%s session=%s prompt_chars=%d",
        dispatch.agent_name,
        dispatch.session_id,
        len(dispatch.instructions),
    )

    await ctx.connect()

    participant = await ctx.wait_for_participant()
    logger.info("participant joined: %s", participant.identity)

    session = AgentSession(
        stt=deepgram.STT(model=config.STT_MODEL, api_key=config.DEEPGRAM_API_KEY),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.ELEVENLABS_VOICE_ID, api_key=config.ELEVENLABS_API_KEY
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    session_done = asyncio.Event()

    @session.on("close")
    def on_close():
        logger.info("session close event")
        session_done.set()

    @ctx.room.on("disconnected")
    def on_disconnect():
        logger.info("room disconnected")
        session_done.set()

    await session.start(
        room=ctx.room,
        agent=PrototypeAgent(instructions=dispatch.instructions),
    )

    name = _participant_display_name(participant)
    await session.say(f"Hi {name}, you're talking to the prototype agent. How can I help?")

    await session_done.wait()
    logger.info("entrypoint exiting")


def _participant_display_name(participant: rtc.RemoteParticipant) -> str:
    return participant.name or participant.identity or "there"


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
