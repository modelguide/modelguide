"""LiveKit voice-agent entrypoint that fetches its prompt at runtime.

Lifecycle per session:

    1. Parse dispatch metadata (carries the ModelGuide session_id when
       the voice-test endpoint pre-created one — see ADR-014).
    2. Fetch the calling agent's compiled prompt via
       ``GET /api/agents/me`` using the worker's mgk_* API key.
    3. If MG didn't pre-create a session, create one now so the call
       still shows up in the dashboard.
    4. Run the LiveKit AgentSession (STT → LLM → TTS).
    5. On disconnect, post the transcript and mark the session
       completed/abandoned.

The point of this worker is the prompt fetch in step 2: it makes
"Compile → click Talk to agent" pick up the latest prompt without a
worker redeploy.

CLI:
    python src/main.py console     (text-only, no WebRTC)
    python src/main.py dev         (full WebRTC, local LiveKit)
    python src/main.py start       (production worker)
"""

from __future__ import annotations

import asyncio
import json
import logging

from livekit import agents
from livekit.agents import AgentSession
from livekit.plugins import openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
from dynamic_agent import DynamicAgent
from prompt_loader import load_prompt
from providers import create_stt, create_tts

VERSION = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info(
        "%s prompt-test agent v%s — entrypoint called",
        config.AGENT_NAME,
        VERSION,
    )

    # Voice-test dispatch metadata (from POST /agents/:id/voice-test-token)
    # carries a pre-created session_id; for non-voice-test rooms we create
    # one ourselves below.
    dispatch_metadata: dict = {}
    if ctx.job.metadata:
        try:
            dispatch_metadata = json.loads(ctx.job.metadata)
        except json.JSONDecodeError:
            logger.warning(
                "Invalid JSON in job metadata: %s", ctx.job.metadata[:100]
            )

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # Fetch the live compiled prompt from ModelGuide. Falls back to
    # FALLBACK_PROMPT on any failure (see prompt_loader.py) — never
    # raises, because dead air on a live call is the worst outcome.
    http = mg_client.get_http_client()
    instructions = await load_prompt(
        http,
        api_url=config.MODELGUIDE_API_URL,
        api_key=config.MODELGUIDE_API_KEY,
    )

    user_identifier = (
        dispatch_metadata.get("user_identifier")
        or dispatch_metadata.get("email")
        or participant.identity
        or config.USER_EMAIL
    )

    session_id = dispatch_metadata.get("session_id")
    if not session_id:
        try:
            session_id = await mg_client.create_session(user_identifier)
        except Exception:
            logger.exception(
                "Failed to create ModelGuide session — running without tracking"
            )
    logger.info(
        "ModelGuide session: %s (user: %s)", session_id, user_identifier
    )

    agent = DynamicAgent(session_id=session_id, instructions=instructions)
    stt = create_stt()
    tts = create_tts()

    session = AgentSession(
        stt=stt,
        llm=openai.LLM(
            model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY
        ),
        tts=tts,
        vad=silero.VAD.load(),
        turn_detection="stt" if config.STT_MODEL == "flux" else EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    @session.on("user_input_transcribed")
    def _on_user_speech(ev):
        if ev.is_final:
            agent.transcript.add_user_utterance(ev.transcript)

    @session.on("conversation_item_added")
    def _on_conversation_item(ev):
        item = ev.item
        if not (hasattr(item, "role") and item.role == "assistant"):
            return
        text = _extract_text(item)
        if text:
            agent.transcript.add_assistant_response(text)

    session_done = asyncio.Event()

    @session.on("close")
    def _on_close():
        logger.info("Session close event fired")
        session_done.set()

    @ctx.room.on("disconnected")
    def _on_disconnect():
        logger.info("Room disconnected event fired")
        session_done.set()

    await session.start(room=ctx.room, agent=agent)

    # Opening line. Keep it short — the LLM's first reply is what the
    # operator cares about hearing.
    await session.say(config.GREETING)

    try:
        await session_done.wait()
    finally:
        logger.info(
            "Running cleanup (messages: %d)",
            len(agent.transcript.get_messages()),
        )
        await _cleanup(session_id, agent)


def _extract_text(item) -> str:
    """Extract text from a conversation item's content."""
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


async def _cleanup(session_id: str | None, agent: DynamicAgent) -> None:
    """Post transcript and complete the ModelGuide session."""
    if not session_id:
        await mg_client.close_http_client()
        return
    try:
        messages = agent.transcript.get_messages()
        status = "completed" if len(messages) > 1 else "abandoned"
        if messages:
            await mg_client.add_messages(session_id, messages)
            logger.info(
                "Posted %d messages to session %s", len(messages), session_id
            )
        await mg_client.complete_session(session_id, status=status)
    except Exception:
        logger.exception(
            "Failed to post transcript / complete session %s", session_id
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
