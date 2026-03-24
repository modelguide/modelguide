"""LiveKit voice agent entry point.

Usage:
  python src/agent.py console       (text-only, no WebRTC)
  python src/agent.py dev           (full WebRTC, local LiveKit)
  python src/agent.py start         (production worker)
  python src/agent.py connect       (attach to existing room)
  python src/agent.py download-files
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
from buildpro import BuildProAgent
from hangup import HangupAction, HangupStateMachine
from prompts import GREETING
from providers import create_stt, create_tts
from tracing import setup_langfuse

VERSION = "0.3.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info("%s agent v%s — entrypoint called", config.AGENT_NAME, VERSION)

    # Langfuse tracing (opt-in via env vars)
    trace_provider = setup_langfuse(session_metadata={
        "langfuse.session.id": ctx.room.name,
    })
    if trace_provider:
        async def _flush_traces():
            trace_provider.force_flush()
        ctx.add_shutdown_callback(_flush_traces)

    await ctx.connect()

    # Concurrent init — session + MCP + participant wait overlap
    async def _init_session():
        try:
            sid = await mg_client.create_session(config.USER_EMAIL)
            logger.info("ModelGuide session: %s", sid)
            return sid
        except Exception:
            logger.exception("Failed to create ModelGuide session — running without tracking")
            return None

    async def _init_mcp():
        conn = mg_client.MCPConnection()
        try:
            await conn.connect()
            return conn
        except Exception:
            logger.exception("Failed to open persistent MCP connection — falling back to one-shot")
            return None

    participant, session_id, mcp = await asyncio.gather(
        ctx.wait_for_participant(),
        _init_session(),
        _init_mcp(),
    )
    logger.info("Participant joined: %s", participant.identity)

    # Build agent + session
    agent = BuildProAgent(session_id=session_id, user_email=config.USER_EMAIL, mcp=mcp)
    stt = create_stt()
    tts = create_tts()

    session = AgentSession(
        stt=stt,
        llm=openai.LLM(model=config.LLM_MODEL, api_key=config.OPENAI_API_KEY),
        tts=tts,
        vad=silero.VAD.load(),
        turn_detection="stt" if config.STT_MODEL == "flux" else EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )

    # --- Event handlers ---
    hangup = HangupStateMachine()
    _hangup_task = None  # prevent GC

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        if ev.is_final:
            agent._transcript.add_user_utterance(ev.transcript)
            hangup.on_user_speech(ev.transcript)

    @session.on("conversation_item_added")
    def on_conversation_item(ev):
        nonlocal _hangup_task
        item = ev.item
        if not (hasattr(item, "role") and item.role == "assistant"):
            return
        text = _extract_text(item)
        if not text:
            return
        agent._transcript.add_assistant_response(text)
        action = hangup.on_agent_speech(text)
        if action is HangupAction.SHUTDOWN:
            async def _delayed_shutdown():
                await asyncio.sleep(3.0)
                session.shutdown()
            _hangup_task = asyncio.create_task(_delayed_shutdown())

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev):
        """Cycle TTS WebSocket when agent finishes speaking."""
        if ev.new_state == "listening" and ev.old_state == "speaking":
            try:
                if hasattr(tts, '_current_connection') and tts._current_connection:
                    tts._current_connection.mark_non_current()
                    logger.info("TTS connection cycled (speaking → listening)")
            except Exception as e:
                logger.warning("TTS connection cycling failed: %s", e)

    @session.on("metrics_collected")
    def on_metrics(ev):
        try:
            for m in ev.metrics:
                if hasattr(m, "ttft"):
                    logger.info("LLM TTFT: %dms", int(m.ttft * 1000))
                elif hasattr(m, "duration"):
                    logger.info("STT segment: %dms", int(m.duration * 1000))
        except Exception:
            pass

    session_done = asyncio.Event()

    @session.on("close")
    def on_close():
        logger.info("Session close event fired")
        session_done.set()

    @ctx.room.on("disconnected")
    def on_disconnect():
        logger.info("Room disconnected event fired")
        session_done.set()

    # --- Start session ---
    await session.start(room=ctx.room, agent=agent)

    # TTS greeting + prompt cache warmup run concurrently
    name = participant.name or participant.identity or "there"

    async def _warmup_prompt_cache():
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
            resp = await client.chat.completions.create(
                model=config.LLM_MODEL,
                messages=[{"role": "system", "content": agent.instructions}],
                max_tokens=1,
            )
            logger.info("Prompt cache warmed (%d prompt tokens)", resp.usage.prompt_tokens)
        except Exception:
            logger.debug("Prompt cache warmup failed (non-critical)")

    await asyncio.gather(
        session.say(GREETING.format(name=name)),
        _warmup_prompt_cache(),
    )

    # Keep alive until session/room ends, then cleanup
    try:
        await session_done.wait()
    finally:
        logger.info("Running cleanup (messages: %d)", len(agent._transcript.get_messages()))
        await _cleanup(session_id, agent, mcp)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


async def _cleanup(session_id: str | None, agent: BuildProAgent, mcp) -> None:
    """Post transcript and complete the ModelGuide session."""
    if not session_id:
        return
    try:
        messages = agent._transcript.get_messages()
        status = "completed" if len(messages) > 1 else "abandoned"
        if messages:
            await mg_client.add_messages(session_id, messages)
            logger.info("Posted %d messages to session %s", len(messages), session_id)
        await mg_client.complete_session(session_id, status=status)
    except Exception:
        logger.exception("Failed to post transcript / complete session %s", session_id)
    finally:
        if mcp:
            await mcp.close()
        await mg_client.close_http_client()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.AGENT_NAME,
        )
    )
