"""LiveKit POC voice agent entrypoint.

Boots a LiveKit AgentSession, fetches the latest compiled prompt from
ModelGuide on connect, and runs a vanilla STT → LLM → TTS pipeline. No
custom tools, no SOP machinery — the smallest possible "talk to the
latest dashboard prompt" demo.

Usage:
    python -m livekit_poc_agent.agent console   # text-only, no WebRTC
    python -m livekit_poc_agent.agent dev       # WebRTC, local LiveKit server
    python -m livekit_poc_agent.agent start     # production worker
"""

from __future__ import annotations

import json
import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

from . import config, mg_session, runtime_config

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext):
    """Called by the LiveKit worker for every dispatched room."""
    config.validate()
    logger.info("livekit-poc-agent v%s — entrypoint", VERSION)

    # Dispatch metadata from createVoiceTestSession (see modelguide-api
    # buildVoiceTestDispatchMetadata). The voice-test flow includes a
    # pre-created session_id so the first transcript hits the right call.
    md: dict = {}
    if ctx.job.metadata:
        try:
            md = json.loads(ctx.job.metadata)
        except json.JSONDecodeError:
            logger.warning("invalid job metadata: %s", ctx.job.metadata[:200])

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("participant joined: %s", participant.identity)

    # 1. Fetch the latest compiled prompt from ModelGuide. Fail open: if
    #    the API is unreachable we still complete the call using the
    #    baked-in fallback so the operator hears *something*.
    instructions = config.FALLBACK_INSTRUCTIONS
    rt: runtime_config.RuntimeConfig | None = None
    try:
        rt = await runtime_config.fetch(
            base_url=config.MODELGUIDE_API_URL, api_key=config.MODELGUIDE_API_KEY
        )
        instructions = runtime_config.resolve_instructions(
            rt, fallback=config.FALLBACK_INSTRUCTIONS
        )
        logger.info(
            "runtime-config loaded: agent=%s compiledAt=%s len=%d",
            rt.slug,
            rt.compiled_at,
            len(instructions),
        )
    except Exception:
        logger.exception("runtime-config fetch failed — using fallback prompt")

    # 2. Session bookkeeping. Voice-test pre-creates the session so the
    #    dashboard can show "Session sess-…" before audio starts; for any
    #    other dispatch we create one ourselves.
    user_identifier = md.get("user_identifier") or md.get("email") or "voice-caller"
    session_id: str | None = md.get("session_id")
    if not session_id:
        session_id = await mg_session.create_session(
            base_url=config.MODELGUIDE_API_URL,
            api_key=config.MODELGUIDE_API_KEY,
            user_identifier=user_identifier,
        )
    logger.info("session=%s user=%s", session_id, user_identifier)

    # 3. Build the LiveKit AgentSession. We use the same provider stack as
    #    the full BuildPro Sam example so deployment artifacts (Dockerfile,
    #    LiveKit Cloud worker config) carry over.
    agent = Agent(instructions=instructions)
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", api_key=config.DEEPGRAM_API_KEY),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            voice_id=config.ELEVENLABS_VOICE_ID,
            api_key=config.ELEVENLABS_API_KEY,
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    await session.start(room=ctx.room, agent=agent)

    # Greet the caller. We use a static greeting rather than asking the
    # LLM to generate one so first-token latency stays predictable.
    await session.say("Hi! I'm listening.")

    async def _on_shutdown():
        if session_id:
            await mg_session.complete_session(
                base_url=config.MODELGUIDE_API_URL,
                api_key=config.MODELGUIDE_API_KEY,
                session_id=session_id,
            )

    ctx.add_shutdown_callback(_on_shutdown)


def main() -> None:
    """CLI entrypoint — same surface as the LiveKit ``agents`` CLI."""
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )


if __name__ == "__main__":
    main()
