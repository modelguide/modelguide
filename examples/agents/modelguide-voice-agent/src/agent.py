"""LiveKit voice-agent entrypoint that pulls its system prompt from
ModelGuide at job-start.

Run modes:

  python src/agent.py console     # text-only REPL (no WebRTC)
  python src/agent.py dev         # full WebRTC, local LiveKit server
  python src/agent.py start       # production worker

The "compile prompt → click voice test → talk" loop in the dashboard
relies on the worker fetching the *latest* compiled prompt every time a
new room job arrives, so iteration time stays sub-second.
"""

from __future__ import annotations

import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
from agent_factory import resolve_instructions
from dispatch import parse_dispatch_metadata
from runtime_config import RuntimeConfig, RuntimeConfigError, fetch_runtime_config

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("agent")


async def _load_runtime_config() -> RuntimeConfig | None:
    """Fetch runtime config from ModelGuide. Logs and returns None on failure
    so the worker can fall back to env defaults rather than crashing."""
    try:
        cfg = await fetch_runtime_config(
            config.MODELGUIDE_API_URL, config.MODELGUIDE_API_KEY
        )
        logger.info(
            "Runtime config loaded: agent=%s slug=%s compiled=%s",
            cfg.id,
            cfg.slug,
            cfg.has_compiled_prompt,
        )
        return cfg
    except RuntimeConfigError as exc:
        logger.warning("Runtime config fetch failed (%s) — using env fallback", exc)
        return None


async def entrypoint(ctx: agents.JobContext) -> None:
    config.validate()
    logger.info("modelguide-voice-agent entrypoint — room=%s", ctx.room.name)

    metadata = parse_dispatch_metadata(ctx.job.metadata)
    if metadata:
        logger.info(
            "Dispatch metadata: mode=%s agentId=%s slug=%s",
            metadata.mode,
            metadata.agent_id,
            metadata.agent_slug,
        )

    await ctx.connect()

    runtime = await _load_runtime_config()
    instructions = resolve_instructions(
        runtime=runtime,
        env_default=config.DEFAULT_INSTRUCTIONS or None,
    )

    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

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
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    await session.start(agent=agent, room=ctx.room)

    name = runtime.name if runtime else "there"
    await session.say(
        f"Hi {name} — I'm using the latest compiled prompt from ModelGuide. What can I do for you?"
    )


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
