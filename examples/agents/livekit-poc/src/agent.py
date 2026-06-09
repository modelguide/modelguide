"""POC LiveKit voice agent — dynamic prompt loading from ModelGuide.

Usage:
  python src/agent.py console       (text-only, no WebRTC)
  python src/agent.py dev           (full WebRTC, local LiveKit)
  python src/agent.py start         (production worker, LiveKit Cloud)

The whole point of this POC: editing the prompt in the dashboard and
clicking "Talk to agent" should run the new prompt — no redeploy. The
worker fetches the compiled prompt from ModelGuide at session start
via ``GET /api/agents/me/runtime-config``, so the prompt that comes out
of the compiler is the prompt the LLM sees.

Conversation-only — no MCP tools. Adding tools is the next layer (see
``examples/agents/livekit-agent`` for the full pattern); the POC stays
small so the prompt-loading contract is the only thing in scope.
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
from prompts import build_greeting, build_session_instructions
from providers import create_stt, create_tts

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info(
        "%s POC agent v%s — entrypoint called", config.AGENT_NAME, VERSION
    )

    await ctx.connect()

    # Fetch the compiled prompt + prompt config and wait for the caller
    # in parallel. The HTTP call is small; the participant join can take
    # a couple seconds depending on the client.
    participant, runtime_config = await asyncio.gather(
        ctx.wait_for_participant(),
        mg_client.fetch_runtime_config(),
    )

    if runtime_config:
        logger.info(
            "Runtime config: agent=%s slug=%s compiledAt=%s",
            runtime_config.get("name"),
            runtime_config.get("slug"),
            runtime_config.get("compiledAt"),
        )
    else:
        logger.warning(
            "Runtime config unavailable — using default prompt. "
            "Check MODELGUIDE_API_URL / MODELGUIDE_API_KEY and that the agent is active."
        )

    user_identifier = (
        getattr(participant, "name", None)
        or getattr(participant, "identity", None)
        or "voice-caller"
    )

    session_id = await mg_client.create_session(user_identifier)
    logger.info("ModelGuide session: %s (user: %s)", session_id, user_identifier)

    instructions = build_session_instructions(runtime_config)
    greeting = build_greeting(runtime_config)

    agent = Agent(instructions=instructions)
    session = AgentSession(
        stt=create_stt(),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=create_tts(),
        vad=silero.VAD.load(),
        turn_detection="stt" if config.STT_MODEL == "flux" else EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    session_done = asyncio.Event()

    @session.on("close")
    def on_close():
        logger.info("Session close event fired")
        session_done.set()

    @ctx.room.on("disconnected")
    def on_disconnect():
        logger.info("Room disconnected event fired")
        session_done.set()

    await session.start(room=ctx.room, agent=agent)
    await session.say(greeting)

    try:
        await session_done.wait()
    finally:
        if session_id:
            await mg_client.complete_session(session_id, status="completed")
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
