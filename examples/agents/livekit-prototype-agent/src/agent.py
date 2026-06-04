"""LiveKit prototype voice agent.

Voiceblox-inspired minimal agent. One job: prove that the dashboard's
click-Compile → click-Talk loop can drive what the agent actually says,
without redeploying.

Entry point lifecycle (each dispatched call):

  1. Parse dispatch metadata (mode, agentName slug, session_id).
  2. ``GET /api/agents/me`` → latest compiled prompt + persona.
  3. Reuse the session ID from voice-test dispatch, or open a new one.
  4. Start an OpenAI Realtime AgentSession with the compiled prompt.
  5. On disconnect, mark the session completed.

No MCP / tools yet — the prototype is conversational only. See the README
for how to graduate to the full BuildPro example with tools.
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession
from livekit.plugins import openai, silero

import config
import mg_client
from dispatch import parse_dispatch_metadata
from runtime_config import build_session_instructions

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("prototype-agent")


def _identifier_for_call(
    participant: rtc.RemoteParticipant, dispatched_user: str | None
) -> str:
    """Pick the user identifier we'll attribute the session to.

    Priority: dispatch metadata (voice-test sets caller email) → SIP phone
    number → participant identity → generic fallback.
    """
    if dispatched_user:
        return dispatched_user
    attrs = participant.attributes or {}
    sip_phone = attrs.get("sip.phoneNumber")
    if sip_phone:
        return sip_phone
    return participant.identity or "voice-caller"


async def entrypoint(ctx: agents.JobContext) -> None:
    config.validate()
    logger.info(
        "%s v%s entrypoint — room=%s",
        config.AGENT_NAME,
        VERSION,
        ctx.room.name,
    )

    dispatch = parse_dispatch_metadata(ctx.job.metadata)
    logger.info(
        "Dispatch metadata: mode=%s slug=%s session=%s",
        dispatch.mode,
        dispatch.agent_slug,
        dispatch.session_id,
    )

    await ctx.connect()

    # Fetch the latest compiled prompt and wait for the caller in parallel.
    # If the runtime-config call fails we can't proceed — there's nothing to
    # say. Let the worker crash so LiveKit retries with a fresh dispatch.
    cfg, participant = await asyncio.gather(
        mg_client.fetch_runtime_config(),
        ctx.wait_for_participant(),
    )

    user_identifier = _identifier_for_call(participant, dispatch.user_identifier)

    # Reuse the API-side session ID for voice-test dispatches so the
    # transcript / analytics row already created on the API matches up.
    # Otherwise open a fresh session here.
    session_id = dispatch.session_id
    if not session_id:
        try:
            session_id = await mg_client.create_session(user_identifier)
        except Exception:
            logger.exception(
                "Failed to create ModelGuide session — running without tracking"
            )

    instructions = build_session_instructions(cfg)
    logger.info(
        "Booting agent slug=%s session=%s prompt_len=%d",
        cfg.slug,
        session_id,
        len(instructions),
    )

    # OpenAI Realtime keeps the prototype to a single provider (STT + LLM +
    # TTS in one round trip). Swap to the STT/LLM/TTS pipeline used by the
    # BuildPro example agent (../livekit-agent/src/providers.py) if you need
    # Deepgram or ElevenLabs.
    realtime = openai.realtime.RealtimeModel(
        model=config.LLM_MODEL,
        api_key=config.OPENAI_API_KEY,
    )

    session = AgentSession(
        llm=realtime,
        vad=silero.VAD.load(),
    )

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close() -> None:
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnected() -> None:
        session_done.set()

    await session.start(room=ctx.room, agent=Agent(instructions=instructions))
    await session.say(f"Hi, this is {cfg.name}. How can I help?")

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
