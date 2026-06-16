"""LiveKit POC voice agent — minimal, prompt-driven, no tools.

Boots an AgentSession (Deepgram STT → OpenAI LLM → ElevenLabs TTS, Silero
VAD, English turn-detector) and hot-loads the agent's compiled prompt
from ModelGuide on every session. There is no MCP, no tool registry, no
connector wiring — the whole point is a fast "compile → click test →
talk" loop for prompt iteration. For the tool-equipped production agent,
see ``examples/agents/livekit-agent/``.

Usage:
  python src/agent.py console      (text-only, no WebRTC)
  python src/agent.py dev          (full WebRTC, local LiveKit)
  python src/agent.py start        (LiveKit Cloud worker)
"""

from __future__ import annotations

import asyncio
import json
import logging

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.plugins import deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
import prompt_loader
from transcript import TranscriptCollector

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info("livekit-poc v%s — entrypoint called", VERSION)

    # Parse dispatch metadata — `agent_id` and `session_id` are stamped by
    # the ModelGuide API in `buildVoiceTestDispatchMetadata`.
    dispatch_metadata: dict = {}
    if ctx.job.metadata:
        try:
            dispatch_metadata = json.loads(ctx.job.metadata)
        except json.JSONDecodeError:
            logger.warning(
                "Invalid JSON in job metadata: %s", ctx.job.metadata[:100]
            )

    # agent_id from dispatch wins; fall back to env for `console` runs.
    agent_id = prompt_loader.extract_agent_id(dispatch_metadata) or (
        config.MODELGUIDE_AGENT_ID or None
    )
    pre_existing_session_id = dispatch_metadata.get("session_id")
    user_identifier = (
        dispatch_metadata.get("user_identifier") or config.USER_EMAIL
    )

    # Connect to the room first so the operator sees "connecting → connected"
    # in the dashboard immediately, before we hit any network.
    await ctx.connect()

    # Fetch the prompt + participant + (optionally) create a session in
    # parallel — none of them depend on each other.
    prompt_task = asyncio.create_task(prompt_loader.load_prompt(agent_id))
    participant_task = asyncio.create_task(ctx.wait_for_participant())

    if pre_existing_session_id:
        session_id: str | None = pre_existing_session_id
        session_task: asyncio.Task[str] | None = None
    else:
        session_id = None
        session_task = asyncio.create_task(
            mg_client.create_session(user_identifier)
        )

    participant = await participant_task
    prompt_result = await prompt_task
    if session_task is not None:
        try:
            session_id = await session_task
        except Exception:
            logger.exception(
                "Failed to create ModelGuide session — running without tracking"
            )

    logger.info(
        "Participant joined: %s | session=%s | prompt source=%s (%d chars)",
        participant.identity,
        session_id,
        prompt_result.source,
        len(prompt_result.text),
    )

    transcript = TranscriptCollector()
    agent = Agent(instructions=prompt_result.text)

    session = AgentSession(
        stt=deepgram.STT(
            model=config.STT_MODEL, api_key=config.DEEPGRAM_API_KEY
        ),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=elevenlabs.TTS(
            api_key=config.ELEVENLABS_API_KEY,
            voice_id=config.ELEVENLABS_VOICE_ID,
            model="eleven_flash_v2_5",
        ),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
    )

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        if ev.is_final:
            transcript.add_user_utterance(ev.transcript)

    @session.on("conversation_item_added")
    def on_conversation_item(ev):
        item = ev.item
        if not (hasattr(item, "role") and item.role == "assistant"):
            return
        text = _extract_text(item)
        if text:
            transcript.add_assistant_response(text)

    session_done = asyncio.Event()

    @session.on("close")
    def on_close():
        session_done.set()

    @ctx.room.on("disconnected")
    def on_disconnect():
        session_done.set()

    await session.start(room=ctx.room, agent=agent)

    # Brief greeting — tells the operator the prompt loaded (or didn't).
    name = participant.name or participant.identity or "there"
    if prompt_result.source == "modelguide-api":
        await session.say(f"Hi {name}, I'm using the latest compiled prompt.")
    else:
        await session.say(
            f"Hi {name}, the compiled prompt couldn't be loaded — "
            f"I'm running on a fallback. Please check the dashboard."
        )

    try:
        await session_done.wait()
    finally:
        await _cleanup(session_id, transcript)


def _extract_text(item) -> str:
    if not hasattr(item, "content") or not item.content:
        return ""
    if isinstance(item.content, str):
        return item.content.strip()
    if isinstance(item.content, list):
        return " ".join(
            part if isinstance(part, str) else getattr(part, "text", "")
            for part in item.content
        ).strip()
    return ""


async def _cleanup(
    session_id: str | None, transcript: TranscriptCollector
) -> None:
    if not session_id:
        await mg_client.close_http_client()
        return
    try:
        messages = transcript.get_messages()
        status = "completed" if len(messages) > 1 else "abandoned"
        await mg_client.add_messages(session_id, messages)
        await mg_client.complete_session(session_id, status=status)
        logger.info(
            "Posted %d messages, marked session %s as %s",
            len(messages),
            session_id,
            status,
        )
    finally:
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
