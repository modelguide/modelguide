"""LiveKit POC agent — fetches its compiled prompt at runtime (ADR-015).

Designed to be the smallest viable LiveKit worker that proves the
"compile → click test → talk" loop:

  1. Dashboard operator edits persona / language / SOPs, clicks Compile.
  2. ModelGuide writes the new ``compiledInstructions`` to the agent row.
  3. Operator clicks "Talk to agent" → MG dispatches this worker.
  4. This entrypoint fires, calls ``GET /api/agents/me`` with its own
     API key, and uses the freshly compiled prompt as the system message.
  5. Operator talks; the LLM responds using the latest prompt with no
     redeploy.

Usage:
  python src/agent.py console       — text-only loop (no LiveKit needed)
  python src/agent.py dev           — WebRTC against a local LiveKit server
  python src/agent.py start         — production worker
  python src/agent.py connect       — attach to an existing room
"""

from __future__ import annotations

import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("agent")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def entrypoint(ctx: agents.JobContext) -> None:
    """Called once per LiveKit job — boot the session with the live prompt."""
    config.validate()
    logger.info("POC agent v%s booting (worker=%s)", VERSION, config.AGENT_NAME)

    # 1. Pull the latest compiled prompt before we touch LiveKit. If the
    #    fetch fails we still want to know — the prototype is useless
    #    without a real prompt, so we crash loud rather than serving stale
    #    audio.
    try:
        profile = await mg_client.fetch_agent_profile(
            config.MODELGUIDE_API_URL,
            config.MODELGUIDE_API_KEY,
        )
    except mg_client.ModelGuideError:
        logger.exception("Failed to fetch agent profile — aborting job")
        raise

    instructions = mg_client.resolve_instructions(
        profile, config.FALLBACK_INSTRUCTIONS,
    )
    using_fallback = instructions == config.FALLBACK_INSTRUCTIONS
    logger.info(
        "Booting session for slug=%s compiled=%s (chars=%d)",
        profile.slug,
        not using_fallback,
        len(instructions),
    )

    # 2. Connect to the LiveKit room and wait for the operator to join.
    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # 3. Spin up the AgentSession. Provider stack mirrors the production
    #    agent so the audio behaves the same — only the prompt source differs.
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

    agent = Agent(instructions=instructions)
    await session.start(room=ctx.room, agent=agent)

    # 4. Give an opening line so the operator hears the room is live. If
    #    no prompt is compiled, lean on the fallback greeting so the
    #    "why is it silent?" question doesn't come up.
    greeting = (
        config.FALLBACK_GREETING
        if using_fallback
        else f"Hi! I'm {profile.name}. How can I help today?"
    )
    await session.say(greeting)


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
