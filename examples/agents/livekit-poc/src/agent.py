"""livekit-poc — minimal LiveKit voice worker for ModelGuide.

The point of this worker (versus the buildpro stack next door) is to keep
the surface as small as possible:

- No SOP / MCP integration. No tools. Just STT → LLM → TTS.
- The system prompt is read from dispatch metadata so a fresh compile in
  the dashboard is in effect for the NEXT "Talk to agent" click — no
  worker redeploy required.
- Falls back to a baked-in default if dispatch doesn't carry a prompt,
  so the worker is still useful via plain ``lk dispatch create``.

Inspired by https://github.com/voiceblox-ai/voiceblox (single-purpose voice
agent boilerplate). See ADR-015 for the rationale.

Run modes:

    python src/agent.py console    # text-only smoke test, no LiveKit needed
    python src/agent.py dev        # WebRTC against local LiveKit server
    python src/agent.py start      # production worker (LiveKit Cloud)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

sys.path.insert(0, str(Path(__file__).resolve().parent))

from metadata import parse_dispatch_metadata  # noqa: E402
from prompt import choose_greeting, choose_instructions  # noqa: E402

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("livekit-poc")

AGENT_NAME = os.getenv("LIVEKIT_POC_AGENT_NAME", "livekit-poc")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID") or "TX3LPaxmHKxFdv7VOQHJ"


async def entrypoint(ctx: agents.JobContext) -> None:
    """Called once per dispatched room. Builds an AgentSession on the fly."""
    md = parse_dispatch_metadata(ctx.job.metadata)
    if md.parse_error:
        logger.warning("metadata parse error: %s — falling back to defaults", md.parse_error)

    instructions = choose_instructions(md)
    greeting = choose_greeting(md)

    logger.info(
        "dispatched (mode=%s agentName=%s session=%s instructions_len=%d)",
        md.mode,
        md.agent_name,
        md.session_id,
        len(instructions),
    )

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("participant joined: %s", participant.identity)

    agent = Agent(instructions=instructions)
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", interim_results=True, endpointing_ms=300),
        llm=openai.LLM(model=LLM_MODEL),
        tts=elevenlabs.TTS(voice_id=ELEVENLABS_VOICE_ID, model="eleven_flash_v2_5"),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    await session.start(room=ctx.room, agent=agent)

    # Outbound calls: callee speaks first. Inbound/WebRTC: agent greets.
    if md.phone_number:
        logger.info("outbound call — skipping greeting")
    else:
        await session.say(greeting)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=AGENT_NAME,
        )
    )
