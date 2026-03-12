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

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    EndFrame,
    LLMFullResponseEndFrame,
    LLMMessagesFrame,
    TextFrame,
    TranscriptionFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.daily.transport import DailyParams, DailyTransport

import mg_client
import config
from config import validate as validate_config
from prompts import build_system_prompt
from tools import TOOL_SCHEMAS, handle_tool_call
from transcript import TranscriptCollector

VERSION = "0.19.3"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("bot")
logger.info("BuildPro Sam agent v%s starting", VERSION)


# ---------------------------------------------------------------------------
# Regional endpoint configuration — set REGION=eu for EU endpoints
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
logger.info("Region: %s → OpenAI=%s, Deepgram=%s, ElevenLabs=%s",
            REGION, URLS["openai"] or "default", URLS["deepgram"] or "default", URLS["elevenlabs"])


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

    return OpenAILLMService(api_key=config.OPENAI_API_KEY, model=model, base_url=URLS["openai"])


# ---------------------------------------------------------------------------
# Bot entry point (called by Pipecat Cloud or local runner)
# ---------------------------------------------------------------------------


async def main(transport: DailyTransport):
    """Core pipeline — used by both PCC and local runner."""
    validate_config()
    logger.info("Config validated, setting up pipeline")

    # --- Create ModelGuide session ---
    try:
        session_id = await mg_client.create_session(config.USER_EMAIL)
        logger.info("ModelGuide session: %s", session_id)
    except Exception:
        logger.exception("Failed to create ModelGuide session — running without tracking")
        session_id = "offline"

    # --- Persistent MCP connection ---
    mcp = mg_client.MCPConnection()
    try:
        await mcp.connect()
    except Exception:
        logger.exception("Failed to open persistent MCP connection — tool calls will use one-shot")
        mcp = None

    # --- Transcript collector ---
    transcript = TranscriptCollector()

    # --- Services ---
    stt = DeepgramSTTService(
        api_key=config.DEEPGRAM_API_KEY,
        model="nova-3",
        base_url=URLS["deepgram"],
    )

    llm = _create_llm()

    tts = ElevenLabsTTSService(
        api_key=config.ELEVENLABS_API_KEY,
        voice_id=config.ELEVENLABS_VOICE_ID,
        model="eleven_flash_v2_5",
        url=URLS["elevenlabs"],
    )

    # --- System prompt + context ---
    system_prompt = build_system_prompt(session_id, user_email=config.USER_EMAIL)
    messages = [{"role": "system", "content": system_prompt}]
    tools = TOOL_SCHEMAS if not LLM_MODEL.startswith("gemini") else None
    context = OpenAILLMContext(messages=messages, tools=tools)
    context_aggregator = llm.create_context_aggregator(context)

    # --- Register tool handlers ---
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

    for schema in TOOL_SCHEMAS:
        fn_name = schema["function"]["name"]
        llm.register_function(fn_name, _on_tool_call)

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
            context_aggregator.user(),
            llm,
            turn_latency,
            assistant_transcript_proc,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    # --- Lifecycle events ---
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        participant_id = participant.get("id", "unknown")
        logger.info("Participant joined: %s", participant_id)
        await transport.capture_participant_transcription(participant_id)
        await task.queue_frames(
            [LLMMessagesFrame(messages)]
        )

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
    from pipecatcloud.agent import DailySessionArguments

    logger.info("BuildPro Sam agent v%s — bot() called (PCC)", VERSION)
    transport = DailyTransport(
        args.room_url,
        args.token,
        "BuildPro Sam",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            transcription_enabled=False,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.15)),
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
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.15)),
        ),
    )
    await main(transport)


if __name__ == "__main__":
    os.environ["LOCAL_RUN"] = "1"
    is_local = True
    asyncio.run(local_daily())
