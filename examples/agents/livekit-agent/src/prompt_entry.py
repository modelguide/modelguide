"""LiveKit entrypoint for the prompt-driven Voice Prototype.

Usage:
  python src/prompt_entry.py dev      # local LiveKit
  python src/prompt_entry.py start    # production worker
  python src/prompt_entry.py console  # text-only, useful for unit-tests

This is intentionally a smaller cousin of ``agent.py``. Where ``agent.py``
boots the BuildPro scenario (baked-in prompt + 11 MCP tools + SIP handling),
this entrypoint:

  1. Reads the compiled prompt out of the dispatch metadata
     (``compiled_prompt`` field — set by ``createVoicePrototypeSession`` in
     the ModelGuide API).
  2. Spins up an ``AgentSession`` with that prompt.
  3. Posts the transcript back to ModelGuide on disconnect using the same
     ``mg_client`` helpers BuildPro already uses.

What this does NOT do (on purpose, for now):

  - No tool calling. The prototype's job is "does the prompt sound right",
    not "does the whole tool stack still work".
  - No SIP handling. WebRTC only.
  - No outbound calls. Click-to-dial is a separate feature (ADR-011).

See ``docs/decisions/015-livekit-prompt-driven-voice-prototype.md`` for the
why; ``examples/agents/livekit-agent/PROMPT_AGENT.md`` for the how.
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents
from livekit.agents import AgentSession
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
from prompt_agent import (
    DispatchMetadataError,
    PromptAgent,
    parse_dispatch_metadata,
)
from providers import create_stt, create_tts

PROMPT_AGENT_NAME = "voice-prototype"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("prompt_entry")


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit prompt-driven entrypoint — called once per voice-prototype room."""
    config.validate()

    # Parse the prompt + correlation ids out of dispatch metadata BEFORE we
    # touch the room. If the metadata is malformed, fail fast so the operator
    # sees the error in worker logs instead of hearing dead air.
    try:
        cfg = parse_dispatch_metadata(ctx.job.metadata)
    except DispatchMetadataError as err:
        logger.error("Rejecting dispatch: %s", err)
        return

    logger.info(
        "Voice prototype starting — agent_id=%s session_id=%s prompt_chars=%d",
        cfg.agent_id,
        cfg.session_id,
        len(cfg.compiled_prompt),
    )

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    agent = PromptAgent(config=cfg)

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

    @session.on("user_input_transcribed")
    def _on_user_speech(ev):
        if ev.is_final:
            agent.record_user_utterance(ev.transcript)

    @session.on("conversation_item_added")
    def _on_item(ev):
        item = ev.item
        if not (hasattr(item, "role") and item.role == "assistant"):
            return
        text = _extract_text(item)
        if text:
            agent.record_agent_response(text)

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close():
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect():
        session_done.set()

    await session.start(room=ctx.room, agent=agent)

    # First-utterance greeting kept generic — the compiled prompt drives the
    # personality, so we don't want a baked greeting that contradicts it.
    try:
        await session.say("Hi! I'm ready when you are.")
    except Exception:
        logger.exception("Greeting failed (non-fatal)")

    try:
        await session_done.wait()
    finally:
        await _cleanup(agent)


def _extract_text(item) -> str:
    """Pull the text content out of a LiveKit conversation item."""
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


async def _cleanup(agent: PromptAgent) -> None:
    """Post transcript + complete the ModelGuide session.

    Mirrors ``agent.py`` so an admin reviewing the dashboard sees the same
    shape of session record regardless of which entrypoint produced it.
    """
    try:
        messages = agent.transcript_messages()
        status = "completed" if len(messages) > 1 else "abandoned"
        if messages:
            await mg_client.add_messages(agent.session_id, messages)
            logger.info(
                "Posted %d messages to session %s", len(messages), agent.session_id
            )
        await mg_client.complete_session(agent.session_id, status=status)
    except Exception:
        logger.exception(
            "Failed to post transcript / complete session %s", agent.session_id
        )
    finally:
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=PROMPT_AGENT_NAME,
        )
    )
