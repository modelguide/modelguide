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
import json
import logging

from livekit import agents, api, rtc
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

VERSION = "0.4.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")


# ---------------------------------------------------------------------------
# Dispatch metadata
# ---------------------------------------------------------------------------


def parse_dispatch_metadata(raw: str | None) -> dict:
    """Parse the LiveKit job metadata JSON blob into a dict.

    The ModelGuide API JSON-encodes a small payload (see
    ``buildVoiceTestDispatchMetadata`` in
    ``modelguide-api/src/features/agents/agents.service.ts``) and stuffs
    it into ``ctx.job.metadata``. We return an empty dict for any
    malformed input — a worker crash here takes the whole call down,
    which is worse than running the baked-in fallback profile.
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# ---------------------------------------------------------------------------
# SIP detection
# ---------------------------------------------------------------------------


def _resolve_caller_identity(participant: rtc.RemoteParticipant) -> tuple[str, str | None, bool]:
    """Determine caller identity from participant attributes.

    Returns:
        (user_identifier, caller_phone, is_sip)

    SIP participants have ``sip.trunkPhoneNumber`` and ``sip.phoneNumber``
    attributes set by LiveKit. WebRTC participants have neither.
    """
    attrs = participant.attributes or {}
    trunk_phone = attrs.get("sip.trunkPhoneNumber")
    caller_phone = attrs.get("sip.phoneNumber")

    if trunk_phone or caller_phone:
        # SIP call — use caller's phone number as the user identifier
        user_id = caller_phone or config.USER_EMAIL
        logger.info(
            "SIP caller: phone=%s trunk=%s callID=%s",
            caller_phone,
            trunk_phone,
            attrs.get("sip.callID", "n/a"),
        )
        return user_id, caller_phone, True

    return config.USER_EMAIL, None, False


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

    # Parse dispatch metadata. Outbound calls carry ``phone_number``.
    # Voice-test dispatches from the dashboard may carry
    # ``compiled_instructions`` (ADR-014) — see ``BuildProAgent`` below.
    dispatch_metadata = parse_dispatch_metadata(ctx.job.metadata)
    outbound_phone = dispatch_metadata.get("phone_number")
    compiled_instructions = dispatch_metadata.get("compiled_instructions")
    if compiled_instructions:
        logger.info(
            "Using compiled prompt from dispatch metadata (%d chars, compiled_at=%s)",
            len(compiled_instructions),
            dispatch_metadata.get("compiled_at"),
        )

    await ctx.connect()

    # MCP init helper (shared by both flows)
    async def _init_mcp():
        conn = mg_client.MCPConnection()
        try:
            await conn.connect()
            return conn
        except Exception:
            logger.exception("Failed to open persistent MCP connection — falling back to one-shot")
            return None

    if outbound_phone:
        # --- Outbound flow: dial first, then handle participant ---
        logger.info("Outbound call to %s (room: %s)", outbound_phone, ctx.room.name)

        if not config.SIP_OUTBOUND_TRUNK_ID:
            logger.error("SIP_OUTBOUND_TRUNK_ID not set — cannot dial out")
            return

        mcp_task = asyncio.create_task(_init_mcp())

        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=config.SIP_OUTBOUND_TRUNK_ID,
                    sip_call_to=outbound_phone,
                    participant_identity=outbound_phone,
                    wait_until_answered=True,
                )
            )
            logger.info("Outbound call answered: %s", outbound_phone)
        except Exception:
            logger.exception("Outbound call failed to %s", outbound_phone)
            mcp_task.cancel()
            return

        participant = await ctx.wait_for_participant()
        mcp = await mcp_task

        user_identifier = dispatch_metadata.get("email") or outbound_phone
        session_id = dispatch_metadata.get("session_id")
        is_sip = True
    else:
        # --- Inbound / WebRTC flow ---
        participant, mcp = await asyncio.gather(
            ctx.wait_for_participant(),
            _init_mcp(),
        )
        user_identifier, _caller_phone, is_sip = _resolve_caller_identity(participant)
        session_id = None

    logger.info("Participant joined: %s", participant.identity)

    # Create ModelGuide session (skip if pre-created by API for outbound)
    if not session_id:
        try:
            session_id = await mg_client.create_session(user_identifier)
        except Exception:
            logger.exception("Failed to create ModelGuide session — running without tracking")
    logger.info("ModelGuide session: %s (user: %s)", session_id, user_identifier)

    # Build agent + session
    agent = BuildProAgent(
        session_id=session_id,
        user_email=user_identifier,
        mcp=mcp,
        instructions_override=compiled_instructions,
    )
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

    # Greeting: skip for outbound (callee speaks first), greet for inbound/WebRTC
    if outbound_phone:
        pass  # Don't greet — wait for callee to speak, agent responds naturally
    else:
        name = "there" if is_sip else (participant.name or participant.identity or "there")

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
