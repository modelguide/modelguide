"""voiceblox prototype — minimal LiveKit voice agent for ModelGuide.

Design intent (see ADR-015):

* No prompt baked into code or container — the system prompt is fetched
  from ``GET /api/agents/me/runtime`` on every session start. That endpoint
  returns the latest *compiled* prompt from the ModelGuide dashboard.
* No MCP tools. This agent is a prototype focused on the prompt-edit
  loop. For tool-calling, use ``examples/agents/livekit-agent``.
* Single file, no SOP-on-disk machinery, no profile registry. One worker
  = one ModelGuide agent identified by its API key.

Usage:
  python src/agent.py console       (text-only smoke test)
  python src/agent.py dev           (local LiveKit, WebRTC)
  python src/agent.py start         (production worker for LiveKit Cloud)
  python src/agent.py download-files
"""

from __future__ import annotations

import asyncio
import logging

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
from prompt import build_greeting, build_system_prompt
from providers import create_stt, create_tts

VERSION = "0.1.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("voiceblox.agent")


class VoicebloxAgent(Agent):
    """A LiveKit ``Agent`` whose instructions come from ModelGuide.

    We keep the class deliberately empty — no ``@function_tool`` methods,
    no per-scenario hooks. The behaviour lives in the compiled prompt that
    the operator edits in the dashboard.
    """

    def __init__(self, *, instructions: str):
        super().__init__(instructions=instructions)


def _caller_identifier(participant: rtc.RemoteParticipant) -> str:
    """Best-effort caller identifier.

    For voice-test from the dashboard we hand back the participant identity
    (typically ``user-<userid>-<nanoid>``). For SIP we prefer the caller's
    phone number; for everything else, the LiveKit participant identity.
    Returns ``"voice-caller"`` as a final fallback so downstream
    session-attribution joins never see an empty string.
    """
    attrs = participant.attributes or {}
    return (
        attrs.get("sip.phoneNumber")
        or participant.identity
        or "voice-caller"
    )


async def entrypoint(ctx: agents.JobContext):
    """LiveKit job entrypoint — runs once per room dispatched to this worker."""
    config.validate()
    logger.info("voiceblox agent v%s — entrypoint called", VERSION)

    # Pull the compiled prompt up front so a misconfigured runtime fails
    # loudly before we ever talk to the caller. If the API itself is down we
    # still join the room and speak a fallback — better to greet and
    # apologise than leave the caller hearing dead air.
    try:
        runtime = await mg_client.fetch_runtime()
    except Exception:
        logger.exception("Failed to fetch runtime — using fallback prompt")
        runtime = None

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    user_identifier = _caller_identifier(participant)
    logger.info("Participant joined: %s (identifier=%s)", participant.identity, user_identifier)

    # Create the ModelGuide session AFTER the participant joins, so abandoned
    # dispatches (caller hung up before connecting) don't litter the session
    # log with empty rows.
    session_id: str | None = None
    try:
        session_id = await mg_client.create_session(user_identifier)
    except Exception:
        logger.exception("Failed to create ModelGuide session — running without tracking")

    instructions = build_system_prompt(
        compiled_instructions=runtime.compiled_instructions if runtime else None,
        prompt_config=runtime.prompt_config if runtime else None,
        session_id=session_id,
        user_identifier=user_identifier,
    )

    session = AgentSession(
        stt=create_stt(),
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=create_tts(),
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    # In-memory transcript — posted to ModelGuide on disconnect.
    transcript: list[dict[str, str]] = []

    @session.on("user_input_transcribed")
    def _on_user_speech(ev):
        if ev.is_final:
            transcript.append({"role": "user", "content": ev.transcript})

    @session.on("conversation_item_added")
    def _on_item_added(ev):
        item = ev.item
        if getattr(item, "role", None) != "assistant":
            return
        text = _extract_text(item)
        if text:
            transcript.append({"role": "assistant", "content": text})

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close():
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect():
        session_done.set()

    await session.start(room=ctx.room, agent=VoicebloxAgent(instructions=instructions))
    await session.say(build_greeting(config.GREETING, user_identifier))

    try:
        await session_done.wait()
    finally:
        await _cleanup(session_id, transcript)


def _extract_text(item) -> str:
    """Extract assistant text content from a LiveKit conversation item."""
    content = getattr(item, "content", None)
    if not content:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return " ".join(
            part if isinstance(part, str) else getattr(part, "text", "")
            for part in content
        ).strip()
    return ""


async def _cleanup(session_id: str | None, transcript: list[dict[str, str]]) -> None:
    if not session_id:
        await mg_client.close_http_client()
        return
    try:
        status = "completed" if len(transcript) > 1 else "abandoned"
        if transcript:
            await mg_client.add_messages(session_id, transcript)
        await mg_client.complete_session(session_id, status=status)
    except Exception:
        logger.exception("Failed to flush transcript / complete session %s", session_id)
    finally:
        await mg_client.close_http_client()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
