"""Minimal LiveKit voice agent for ModelGuide.

A voiceblox-style prototype: one file, no MCP tools, no SOPs — just enough
to prove the "compile in dashboard → talk in browser" loop end-to-end.

Flow per dispatched room:

  1. Worker receives dispatch (from the dashboard "Talk to agent" button —
     see ``modelguide-api/src/features/agents/agents.service.ts``).
  2. Open one HTTP connection to ModelGuide, GET /api/agents/me/prompt.
  3. Use the returned ``compiledInstructions`` as the LLM system prompt.
  4. Greet the user, run a normal STT→LLM→TTS loop until they hang up.

The control-plane round-trip is on the room-join critical path. If the
fetch fails the agent still starts — see ``prompt_fetcher.py`` for the
fallback behaviour.

Usage:
    python src/agent.py dev      # local LiveKit (WebRTC)
    python src/agent.py console  # text-only (no LiveKit needed)
    python src/agent.py start    # production worker (LiveKit Cloud)
"""

from __future__ import annotations

import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
from instructions import compose_instructions
from prompt_fetcher import PromptFetcher, build_authenticated_client

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")

VERSION = "0.1.0"


async def entrypoint(ctx: agents.JobContext):
    """Called once per dispatched room."""
    config.validate()
    logger.info("%s prototype v%s starting", config.AGENT_NAME, VERSION)

    await ctx.connect()

    # 1. Pull the latest prompt from ModelGuide *before* the user joins.
    #    The voice-test dispatcher waits for the participant in parallel,
    #    so this fetch is genuinely on the critical path — keep it small.
    http_client = build_authenticated_client(
        config.MODELGUIDE_API_URL, config.MODELGUIDE_API_KEY
    )
    try:
        fetcher = PromptFetcher(http_client)
        fetched = await fetcher.fetch()
    finally:
        # Close the one-shot client now — the agent loop only needed the
        # prompt. (A future iteration that posts transcripts will keep a
        # pooled client around.)
        await http_client.aclose()

    instructions = compose_instructions(fetched)
    logger.info(
        "Prompt loaded: agent=%s fallback=%s compiled_at=%s chars=%d",
        fetched.agent_name or "<unknown>",
        fetched.is_fallback,
        fetched.compiled_at or "<never>",
        len(instructions),
    )

    # 2. Wait for the human participant.
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # 3. Standard STT→LLM→TTS pipeline.
    session = AgentSession(
        stt=deepgram.STT(model=config.STT_MODEL, api_key=config.DEEPGRAM_API_KEY),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.ELEVENLABS_VOICE_ID,
            api_key=config.ELEVENLABS_API_KEY,
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    await session.start(room=ctx.room, agent=Agent(instructions=instructions))
    await session.say(config.GREETING)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
