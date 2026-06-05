"""LiveKit POC voice agent — pulls its system prompt from ModelGuide at job start.

Usage:
  python src/agent.py console     (text-only, no WebRTC)
  python src/agent.py dev         (full WebRTC, local LiveKit)
  python src/agent.py start       (production worker)

What this proves:
  Same worker image can serve any agent in any org because the system
  prompt is fetched live from ``GET /api/agents/me`` at every job
  dispatch. Compile a new prompt in the dashboard → click "Talk to
  agent" → the very next job pulls the new prompt. No redeploy.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_profile

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("prompt_poc")


def _build_mg_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.MODELGUIDE_API_URL,
        headers={"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"},
        timeout=10.0,
    )


async def entrypoint(ctx: agents.JobContext) -> None:
    """Called once per LiveKit room. Boots a session with a freshly-fetched prompt."""
    config.validate()
    logger.info("%s v%s — entrypoint called", config.AGENT_NAME, VERSION)

    await ctx.connect()

    async with _build_mg_client() as mg:
        try:
            profile = await mg_profile.fetch_profile(mg)
        except mg_profile.ProfileFetchError as err:
            logger.error("Could not fetch agent profile from ModelGuide: %s", err)
            raise

    system_prompt = mg_profile.resolve_system_prompt(profile)
    logger.info(
        "Loaded prompt for agent %s (slug=%s, compiledAt=%s, has_compiled=%s, length=%d)",
        profile.name,
        profile.slug,
        profile.compiled_at,
        profile.has_compiled_prompt,
        len(system_prompt),
    )

    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    voice_agent = Agent(instructions=system_prompt)
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

    await session.start(room=ctx.room, agent=voice_agent)
    await session.say(config.GREETING)

    try:
        await session_done.wait()
    finally:
        logger.info("Session ended for agent %s", profile.slug)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
