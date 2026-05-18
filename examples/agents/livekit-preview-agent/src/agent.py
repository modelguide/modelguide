"""LiveKit preview-agent entrypoint.

A minimal worker whose only job is: take the ``instructions_override``
field from dispatch metadata and use it as the LLM system prompt for a
voice conversation. No MCP, no tools, no profile registry — preview is
about hearing the *prompt*, not the surrounding orchestration.

This worker is the worker-side half of the ``POST /api/agents/:id/preview-voice-token``
flow (see ADR-015). The API:

  1. Compiles or accepts a freshly compiled prompt.
  2. Dispatches **this** worker (by name ``env.LIVEKIT_PREVIEW_AGENT_NAME``)
     into a fresh room with the prompt in ``metadata.instructions_override``.
  3. Mints a browser AccessToken so the operator can talk into the room.

If the dispatch arrives without ``mode == "preview"`` or without a
prompt, the worker disconnects rather than limping along with an empty
prompt (which would produce an open-ended "ChatGPT-ish" voice agent
totally unrelated to what the operator is trying to test).

Usage:
  python src/agent.py console       (text-only, no WebRTC)
  python src/agent.py dev           (full WebRTC, local LiveKit)
  python src/agent.py start         (production worker)
"""

from __future__ import annotations

import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
from dispatch import parse_dispatch_metadata

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("preview-agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """Called once per LiveKit job (room).

    The worker:
      1. Parses dispatch metadata.
      2. Resolves the prompt (override -> fallback).
      3. Starts an AgentSession with that prompt and greets the room.
    """
    config.validate()
    logger.info(
        "preview-agent v%s entrypoint room=%s job_id=%s",
        VERSION,
        ctx.room.name,
        ctx.job.id,
    )

    dispatch = parse_dispatch_metadata(ctx.job.metadata)

    if not dispatch.is_preview:
        logger.warning(
            "Dispatch is not a preview (mode=%r) — disconnecting. "
            "This worker only handles `mode: preview` dispatches.",
            dispatch.mode,
        )
        ctx.shutdown()
        return

    instructions = dispatch.instructions or config.FALLBACK_INSTRUCTIONS
    if not dispatch.instructions:
        logger.warning(
            "Preview dispatch arrived with no instructions_override — "
            "using fallback prompt. Operator will hear 'no prompt' acknowledgement."
        )

    logger.info(
        "preview ready: session_id=%s user=%s prompt_chars=%d",
        dispatch.session_id,
        dispatch.user_identifier,
        len(instructions),
    )

    await ctx.connect()

    session = AgentSession(
        stt=deepgram.STT(
            model=config.STT_MODEL, api_key=config.DEEPGRAM_API_KEY
        ),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.TTS_VOICE_ID, api_key=config.ELEVENLABS_API_KEY
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_endpointing_delay=0.5,
    )

    agent = Agent(instructions=instructions)
    await session.start(room=ctx.room, agent=agent)

    # Short, prompt-agnostic greeting. We deliberately don't try to derive
    # a greeting from the prompt — the whole point is to hear the prompt's
    # own behaviour, not our wrapper's.
    await session.say(
        "Preview ready. Go ahead whenever you'd like.", allow_interruptions=True
    )


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
