"""Main Pipecat pipeline: STT -> LLM -> TTS over Daily or WebRTC transport.

Lifecycle:
  1. On start:  Create ModelGuide session via REST
  2. During:    LLM tool calls execute via MCP
  3. On leave:  Post transcript + complete session

Usage:
  Local Daily:   python src/bot.py                (creates temp Daily room)
  Pipecat Cloud: deployed via pcc-deploy.toml     (platform manages rooms)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time

from pipecat.frames.frames import (
    EndFrame,
    LLMFullResponseEndFrame,
    LLMRunFrame,
    TextFrame,
    TranscriptionFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.daily.transport import DailyParams, DailyTransport

import mg_client
import config
from config import validate as validate_config
from prompts import build_system_prompt
from tools import TOOL_SCHEMAS, handle_tool_call, reset_cart_state, set_tracer
from transcript import TranscriptCollector

VERSION = "0.25.1"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("bot")
logger.info("BuildPro Sam agent v%s starting", VERSION)


# ---------------------------------------------------------------------------
# OpenTelemetry tracing → Langfuse (opt-in via ENABLE_TRACING=1)
# ---------------------------------------------------------------------------

TRACING_ENABLED = bool(os.getenv("LANGFUSE_PUBLIC_KEY"))

if TRACING_ENABLED:
    import base64
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from pipecat.utils.tracing.setup import setup_tracing

    _lf_pk = os.environ["LANGFUSE_PUBLIC_KEY"]
    _lf_sk = os.environ["LANGFUSE_SECRET_KEY"]
    _lf_host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    _lf_auth = base64.b64encode(f"{_lf_pk}:{_lf_sk}".encode()).decode()

    exporter = OTLPSpanExporter(
        endpoint=f"{_lf_host}/api/public/otel",
        headers={"Authorization": f"Basic {_lf_auth}"},
    )
    setup_tracing(service_name="buildpro-sam", exporter=exporter)
    logger.info("OpenTelemetry tracing enabled → %s", _lf_host)

    # Share a tracer with tools.py so MCP calls get individual spans
    from opentelemetry import trace
    set_tracer(trace.get_tracer("buildpro-sam"))


# ---------------------------------------------------------------------------
# Regional endpoint configuration for STT / LLM / TTS services.
#
# NOTE: Even when deployed in EU (Pipecat Cloud eu-central), we keep REGION=us
# because OpenAI EU endpoints require an Enterprise agreement. Deepgram and
# ElevenLabs follow suit for simplicity. Cross-Atlantic LLM latency is
# acceptable (~50-80ms overhead) vs. the enterprise setup cost.
#
# Langfuse tracing is configured separately via LANGFUSE_HOST and should
# point to the EU instance (https://cloud.langfuse.com) since that's where
# the bot and Daily infra operate.
# ---------------------------------------------------------------------------

REGION = os.getenv("REGION", "us").lower()

_REGION_URLS = {
    "us": {
        "openai": None,  # default: api.openai.com
        "deepgram": "",   # default
        "elevenlabs": "wss://api.elevenlabs.io",
    },
    "eu": {
        "openai": "https://eu.api.openai.com/v1",
        "deepgram": "https://api.eu.deepgram.com",
        "elevenlabs": "wss://api.eu.residency.elevenlabs.io",
    },
}

URLS = _REGION_URLS.get(REGION, _REGION_URLS["us"])
logger.info("Region: %s → OpenAI=%s, Deepgram=%s",
            REGION, URLS["openai"] or "default", URLS["deepgram"] or "default")


# ---------------------------------------------------------------------------
# Transcript capture processors
# ---------------------------------------------------------------------------


class UserTranscriptProcessor(FrameProcessor):
    """Captures final user transcriptions for the transcript."""

    def __init__(self, transcript: TranscriptCollector) -> None:
        super().__init__()
        self._transcript = transcript

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text:
            self._transcript.add_user_utterance(frame.text)
        await self.push_frame(frame, direction)


class AssistantTranscriptProcessor(FrameProcessor):
    """Captures assistant TTS text for the transcript."""

    def __init__(self, transcript: TranscriptCollector) -> None:
        super().__init__()
        self._transcript = transcript
        self._current_sentence = ""

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TextFrame) and frame.text:
            self._current_sentence += frame.text
        if isinstance(frame, LLMFullResponseEndFrame) and self._current_sentence.strip():
            self._transcript.add_assistant_response(self._current_sentence.strip())
            self._current_sentence = ""
        await self.push_frame(frame, direction)


class TurnLatencyLogger(FrameProcessor):
    """Logs per-turn latency: user speech → first LLM text token."""

    def __init__(self) -> None:
        super().__init__()
        self._user_speech_at: float | None = None
        self._waiting_for_response = False
        self._turn_count = 0

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text:
            self._user_speech_at = time.monotonic()
            self._waiting_for_response = True
        if isinstance(frame, TextFrame) and frame.text and self._waiting_for_response:
            self._waiting_for_response = False
            self._turn_count += 1
            if self._user_speech_at:
                latency_ms = int((time.monotonic() - self._user_speech_at) * 1000)
                logger.info("Turn %d latency: %dms (STT→LLM first token)", self._turn_count, latency_ms)
        await self.push_frame(frame, direction)


# ---------------------------------------------------------------------------
# LLM factory — switch models via LLM_MODEL env var
# ---------------------------------------------------------------------------

LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")


def _openai_tools_to_google(openai_tools):
    """Convert OpenAI-format tool schemas to Google function declarations."""
    from google.genai.types import FunctionDeclaration, Tool

    declarations = []
    for tool in openai_tools:
        func = tool["function"]
        declarations.append(FunctionDeclaration(
            name=func["name"],
            description=func.get("description", ""),
            parameters=func.get("parameters"),
        ))
    return [Tool(function_declarations=declarations)]


def _create_llm():
    model = LLM_MODEL
    logger.info("LLM model: %s", model)

    if model.startswith("gemini"):
        from pipecat.services.google.llm import GoogleLLMService, GoogleThinkingConfig

        return GoogleLLMService(
            api_key=config.GOOGLE_API_KEY,
            model=model,
            tools=_openai_tools_to_google(TOOL_SCHEMAS),
            params=GoogleLLMService.InputParams(
                thinking=GoogleThinkingConfig(thinking_budget=128),
            ),
        )

    return OpenAILLMService(
        api_key=config.OPENAI_API_KEY,
        base_url=URLS["openai"],
        settings=OpenAILLMService.Settings(model=model),
    )


# ---------------------------------------------------------------------------
# TTS factory — switch providers via TTS_PROVIDER env var
# ---------------------------------------------------------------------------


def _create_tts():
    provider = config.TTS_PROVIDER
    logger.info("TTS provider: %s", provider)

    if provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        tts = CartesiaTTSService(
            api_key=config.CARTESIA_API_KEY,
            settings=CartesiaTTSService.Settings(
                voice=config.CARTESIA_VOICE_ID,
                model="sonic-3",
            ),
        )
        # Cartesia accumulates context_ids on the WebSocket server-side,
        # degrading TTFB from 0.3s to 5s+ over a session. Cycle connections
        # every 30s to keep latency consistent.
        try:
            tts._pool._max_session_duration = 30
            tts._pool._mark_refreshed_on_get = False
        except AttributeError:
            logger.debug("Cartesia WS pool cycling not available in this version")
        return tts

    # Fallback: ElevenLabs
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

    return ElevenLabsTTSService(
        api_key=config.ELEVENLABS_API_KEY,
        settings=ElevenLabsTTSService.Settings(
            voice=config.ELEVENLABS_VOICE_ID,
            model="eleven_flash_v2_5",
        ),
        url=URLS["elevenlabs"],
    )


# ---------------------------------------------------------------------------
# Bot entry point (called by Pipecat Cloud or local runner)
# ---------------------------------------------------------------------------


async def main(transport: DailyTransport):
    """Core pipeline — used by both PCC and local runner."""
    validate_config()
    logger.info("Config validated, setting up pipeline")

    # Reset cart state for this session
    reset_cart_state()

    # --- Create ModelGuide session + MCP connection in parallel ---
    async def _init_session():
        try:
            sid = await mg_client.create_session(config.USER_EMAIL)
            logger.info("ModelGuide session: %s", sid)
            return sid
        except Exception:
            logger.exception("Failed to create ModelGuide session — running without tracking")
            return "offline"

    async def _init_mcp():
        conn = mg_client.MCPConnection()
        try:
            await conn.connect()
            return conn
        except Exception:
            logger.exception("Failed to open persistent MCP connection — tool calls will use one-shot")
            return None

    session_id, mcp = await asyncio.gather(_init_session(), _init_mcp())

    # --- Transcript collector ---
    transcript = TranscriptCollector()

    # --- Services ---
    stt = DeepgramFluxSTTService(
        api_key=config.DEEPGRAM_API_KEY,
        settings=DeepgramFluxSTTService.Settings(
            eot_threshold=0.5,
        ),
    )

    llm = _create_llm()

    tts = _create_tts()

    # --- System prompt + context ---
    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)
    ctx_kwargs = {"messages": [{"role": "system", "content": system_prompt}]}
    if not LLM_MODEL.startswith("gemini"):
        ctx_kwargs["tools"] = TOOL_SCHEMAS
    context = LLMContext(**ctx_kwargs)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(sample_rate=16000),
        ),
    )

    # --- Register catch-all tool handler (all tools route through MCP) ---
    async def _on_tool_call(params: FunctionCallParams):
        result_str = await handle_tool_call(
            tool_name=params.function_name,
            tool_args=params.arguments,
            tool_call_id=params.tool_call_id,
            session_id=session_id,
            transcript=transcript,
            mcp=mcp,
        )
        await params.result_callback(json.loads(result_str))

    llm.register_function(None, _on_tool_call)

    # --- Transcript + latency processors ---
    user_transcript_proc = UserTranscriptProcessor(transcript)
    assistant_transcript_proc = AssistantTranscriptProcessor(transcript)
    turn_latency = TurnLatencyLogger()

    # --- Pipeline ---
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript_proc,
            user_aggregator,
            llm,
            turn_latency,
            assistant_transcript_proc,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    tracing_attrs = {}
    if TRACING_ENABLED:
        tracing_attrs = {
            "langfuse.session.id": session_id,
            "langfuse.user.id": config.USER_EMAIL,
            "langfuse.trace.name": "buildpro-sam-voice",
            "langfuse.release": VERSION,
        }

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        enable_tracing=TRACING_ENABLED,
        enable_turn_tracking=TRACING_ENABLED,
        conversation_id=session_id if TRACING_ENABLED else None,
        additional_span_attributes=tracing_attrs if TRACING_ENABLED else None,
    )

    # --- Lifecycle events ---
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        participant_id = participant.get("id", "unknown")
        logger.info("Participant joined: %s", participant_id)
        await transport.capture_participant_transcription(participant_id)
        await task.queue_frames([LLMRunFrame()])

    # --- Run ---
    transcript_posted = False

    async def _post_transcript(status: str = "completed"):
        nonlocal transcript_posted
        if transcript_posted or session_id == "offline":
            return
        transcript_posted = True
        messages_to_post = transcript.get_messages()
        if messages_to_post:
            await mg_client.add_messages(session_id, messages_to_post)
            logger.info("Posted %d messages to session %s", len(messages_to_post), session_id)
        await mg_client.complete_session(session_id, status=status)

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info("Participant left: %s (reason: %s)", participant.get("id", "unknown"), reason)
        try:
            messages = transcript.get_messages()
            status = "completed" if len(messages) > 1 else "abandoned"
            await _post_transcript(status=status)
        except Exception:
            logger.exception("Failed to post transcript / complete session %s", session_id)
        finally:
            await task.queue_frame(EndFrame())

    runner = PipelineRunner(handle_sigint=not is_local)
    await runner.run(task)

    # Safety net: post transcript if pipeline ended without on_participant_left
    try:
        await _post_transcript(status="abandoned")
    except Exception:
        logger.exception("Failed to post transcript in cleanup for session %s", session_id)

    # Close persistent MCP connection
    if mcp:
        try:
            await mcp.close()
        except Exception:
            logger.debug("MCP close error in cleanup (expected)")


# ---------------------------------------------------------------------------
# PCC entry point
# ---------------------------------------------------------------------------

is_local = bool(os.getenv("LOCAL_RUN"))


async def bot(args):
    """Called by Pipecat Cloud's app.py."""
    logger.info("BuildPro Sam agent v%s — bot() called (PCC)", VERSION)
    transport = DailyTransport(
        args.room_url,
        args.token,
        "BuildPro Sam",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_enabled=True,
            vad_audio_passthrough=True,
        ),
    )
    await main(transport)


# ---------------------------------------------------------------------------
# Local runner — `python bot.py` from src/
# ---------------------------------------------------------------------------

async def local_daily():
    """Create a temp Daily room and run the pipeline locally."""
    import aiohttp
    from dotenv import load_dotenv

    load_dotenv(override=True)
    daily_api_key = os.getenv("DAILY_API_KEY")
    if not daily_api_key:
        logger.error("DAILY_API_KEY not set in .env — get one from https://dashboard.daily.co")
        sys.exit(1)

    import time

    async with aiohttp.ClientSession() as session:
        # Create a temporary Daily room
        headers = {"Authorization": f"Bearer {daily_api_key}"}
        async with session.post(
            "https://api.daily.co/v1/rooms",
            headers=headers,
            json={"properties": {"exp": int(time.time()) + 3600}},
        ) as resp:
            room = await resp.json()
            if "url" not in room:
                logger.error("Daily API error: %s", room)
                sys.exit(1)
            room_url = room["url"]

        # Get a meeting token
        async with session.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers=headers,
            json={"properties": {"room_name": room["name"], "is_owner": True}},
        ) as resp:
            token_data = await resp.json()
            token = token_data["token"]

    logger.info("Join the Daily room: %s", room_url)

    import webbrowser
    webbrowser.open(room_url)

    transport = DailyTransport(
        room_url,
        token,
        "BuildPro Sam",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_enabled=True,
            vad_audio_passthrough=True,
        ),
    )
    await main(transport)


if __name__ == "__main__":
    os.environ["LOCAL_RUN"] = "1"
    is_local = True
    asyncio.run(local_daily())
