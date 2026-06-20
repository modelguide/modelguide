"""livekit-poc — minimal voice agent that reads its prompt from dispatch.

Inspired by the voiceblox-ai layout: keep the entrypoint short, lean on
LiveKit's ``AgentSession`` + OpenAI Realtime for the audio loop, and
treat the prompt as data that arrives at dispatch time rather than as
code baked into the worker image.

The result is a tight "compile prompt → click Talk → hear the change"
loop from the ModelGuide dashboard: the API ships the agent's
``compiledInstructions`` as the ``instructions`` field of the LiveKit
dispatch metadata, and this entrypoint resolves it via
``prompt_resolver.resolve_instructions`` before instantiating the
session.

See:
- ADR-014 for the original voice-test design (no prompt injection).
- ADR-015 for the rationale of this POC and what it deliberately
  does differently.
- ``README.md`` for the local dev loop.

This module is intentionally thin and is NOT covered by unit tests —
the meaningful logic lives in ``prompt_resolver``, ``dispatch_context``,
and ``transcript``, all of which have full unit-test coverage. Running
``python src/agent.py dev`` against a local LiveKit + a real OpenAI key
is how the wiring here gets exercised.
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext
from livekit.plugins import openai

import config
import mg_client
from dispatch_context import parse_dispatch_context
from prompt_resolver import resolve_instructions
from transcript import TranscriptCollector

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("agent")


async def entrypoint(ctx: JobContext) -> None:
    """Called once per LiveKit room/job."""
    config.validate()
    logger.info(
        "livekit-poc v%s entrypoint — room=%s", VERSION, ctx.room.name
    )

    dispatch = parse_dispatch_context(ctx.job.metadata)
    resolution = resolve_instructions(metadata_json=ctx.job.metadata)
    logger.info(
        "Prompt resolved: source=%s len=%d (session=%s, agentName=%s)",
        resolution.source,
        len(resolution.instructions),
        dispatch.session_id,
        dispatch.agent_name,
    )

    transcript = TranscriptCollector()

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # Use OpenAI Realtime so the POC ships with a single SDK dependency
    # and skips the STT→LLM→TTS chain. Production agents
    # (livekit-agent/) use Deepgram + GPT + ElevenLabs for finer control.
    session = AgentSession(
        llm=openai.realtime.RealtimeModel(
            model=config.OPENAI_REALTIME_MODEL,
            voice=config.OPENAI_REALTIME_VOICE,
            api_key=config.OPENAI_API_KEY,
        )
    )

    @session.on("user_input_transcribed")
    def _on_user_speech(ev: object) -> None:  # type: ignore[no-redef]
        text = getattr(ev, "transcript", "") or ""
        if getattr(ev, "is_final", False) and text:
            transcript.add_user_utterance(text)

    @session.on("conversation_item_added")
    def _on_item(ev: object) -> None:  # type: ignore[no-redef]
        item = getattr(ev, "item", None)
        if item is None or getattr(item, "role", None) != "assistant":
            return
        text = _extract_text(item)
        if text:
            transcript.add_assistant_response(text)

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close() -> None:  # type: ignore[no-redef]
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect() -> None:  # type: ignore[no-redef]
        session_done.set()

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=resolution.instructions),
    )

    # Greet the caller using the freshly-loaded prompt so they hear the
    # difference between successive iterations without needing to speak
    # first. The realtime model will respect the system prompt.
    await session.generate_reply(
        instructions=(
            "Greet the caller in one short sentence and offer to help."
        )
    )

    try:
        await session_done.wait()
    finally:
        await _cleanup(dispatch.session_id, transcript)


def _extract_text(item: object) -> str:
    content = getattr(item, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            else:
                parts.append(getattr(part, "text", "") or "")
        return " ".join(parts).strip()
    return ""


async def _cleanup(
    session_id: str | None, transcript: TranscriptCollector
) -> None:
    """Post the transcript and mark the session complete. Best-effort."""
    if not session_id:
        return
    try:
        payload = transcript.to_api_payload()
        if payload:
            await mg_client.post_messages(session_id, payload)
        status = "completed" if len(transcript) > 0 else "abandoned"
        await mg_client.complete_session(session_id, status=status)
        logger.info(
            "Cleanup: session=%s status=%s messages=%d",
            session_id,
            status,
            len(transcript),
        )
    except Exception:
        logger.exception("Cleanup failed for session %s", session_id)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
