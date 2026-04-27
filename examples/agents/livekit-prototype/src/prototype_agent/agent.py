"""LiveKit voice agent — prototype "talk to my latest prompt" worker.

Reads its system prompt from dispatch metadata (see `metadata.py` for the
contract). On dispatch:

    1. Parse `JobContext.job.metadata` → DispatchMetadata.
    2. Connect to the room.
    3. Wait for the participant.
    4. Boot an `AgentSession` with `Agent(instructions=md.instructions, ...)`.
    5. Greet the caller and run the conversation.
    6. On disconnect, log a one-line summary.

This worker is intentionally MCP-free / tool-free — the goal is the tightest
possible feedback loop between editing a prompt in the UI and hearing the
agent's voice change. For tool-equipped voice agents, see the production
worker in `examples/agents/livekit-agent/`.

Usage:
    python -m prototype_agent.agent dev    # local LiveKit, full WebRTC
    python -m prototype_agent.agent start  # production worker
"""

from __future__ import annotations

import logging
import os

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import openai, silero

from prototype_agent.metadata import (
    InvalidDispatchMetadataError,
    parse_dispatch_metadata,
)

VERSION = "0.1.0"
DEFAULT_AGENT_NAME = os.getenv("PROTOTYPE_AGENT_NAME", "modelguide-prototype")
DEFAULT_LLM_MODEL = os.getenv("PROTOTYPE_LLM_MODEL", "gpt-4o-mini")
GREETING = "Hi, I'm ready when you are."

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("prototype_agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit agent entrypoint — one job per dispatched room."""
    logger.info("prototype agent v%s — entrypoint called", VERSION)

    try:
        md = parse_dispatch_metadata(ctx.job.metadata)
    except InvalidDispatchMetadataError as exc:
        # Refusing to start a session with a default prompt would defeat the
        # whole point of this worker. Fail loudly so the dashboard's spinner
        # times out and the operator sees the failure in worker logs.
        logger.error("invalid dispatch metadata — refusing to start: %s", exc)
        return

    logger.info(
        "dispatched — profile=%s session=%s user=%s prompt_len=%d",
        md.agent_name,
        md.session_id,
        md.user_identifier,
        len(md.instructions),
    )

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("participant joined: %s", participant.identity)

    agent = Agent(instructions=md.instructions)
    session = AgentSession(
        stt=openai.STT(),
        llm=openai.LLM(model=DEFAULT_LLM_MODEL),
        tts=openai.TTS(),
        vad=silero.VAD.load(),
        allow_interruptions=True,
    )

    await session.start(room=ctx.room, agent=agent)
    await session.say(GREETING)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=DEFAULT_AGENT_NAME,
        )
    )
