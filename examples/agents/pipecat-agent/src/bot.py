"""Main Pipecat pipeline: Daily transport -> STT -> LLM -> TTS.

Lifecycle:
  1. On start:  Create ModelGuide session via REST
  2. During:    LLM tool calls execute via MCP
  3. On leave:  Post transcript + complete session
"""

import asyncio
import json
import logging

from pipecat.audio.vad.silero import SileroVADAnalyzer
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
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.services.daily import DailyParams, DailyTransport

import mg_client
from config import (
    CARTESIA_API_KEY,
    CARTESIA_VOICE_ID,
    DAILY_API_KEY,
    DEEPGRAM_API_KEY,
    OPENAI_API_KEY,
    USER_EMAIL,
)
from prompts import build_system_prompt
from tools import TOOL_SCHEMAS, handle_tool_call
from transcript import TranscriptCollector

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("bot")


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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main():
    # --- Create Daily room ---
    transport = DailyTransport(
        room_url="",  # Will create a new room
        token=None,
        bot_name="Sam",
        params=DailyParams(
            api_key=DAILY_API_KEY,
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    # --- Create ModelGuide session ---
    session_id = await mg_client.create_session(USER_EMAIL)
    logger.info("ModelGuide session: %s", session_id)

    # --- Transcript collector ---
    transcript = TranscriptCollector()

    # --- Services ---
    stt = DeepgramSTTService(api_key=DEEPGRAM_API_KEY)

    llm = OpenAILLMService(api_key=OPENAI_API_KEY, model="gpt-4o")

    tts = CartesiaTTSService(
        api_key=CARTESIA_API_KEY,
        voice_id=CARTESIA_VOICE_ID,
    )

    # --- System prompt + context ---
    system_prompt = build_system_prompt(session_id, user_email=USER_EMAIL)
    messages = [{"role": "system", "content": system_prompt}]
    context = OpenAILLMContext(messages=messages, tools=TOOL_SCHEMAS)
    context_aggregator = llm.create_context_aggregator(context)

    # --- Register tool handlers ---
    async def _on_tool_call(function_name, tool_call_id, args, llm_instance, context, result_callback):
        result_str = await handle_tool_call(
            tool_name=function_name,
            tool_args=args,
            tool_call_id=tool_call_id,
            session_id=session_id,
            transcript=transcript,
        )
        await result_callback(json.loads(result_str))

    for schema in TOOL_SCHEMAS:
        fn_name = schema["function"]["name"]
        llm.register_function(fn_name, _on_tool_call)

    # --- Transcript processors ---
    user_transcript_proc = UserTranscriptProcessor(transcript)
    assistant_transcript_proc = AssistantTranscriptProcessor(transcript)

    # --- Pipeline ---
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_transcript_proc,
            context_aggregator.user(),
            llm,
            assistant_transcript_proc,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))

    # --- Lifecycle events ---
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        logger.info("Participant joined: %s", participant.get("id", "unknown"))
        # Send initial greeting
        await task.queue_frames(
            [LLMMessagesFrame(messages)]
        )

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info("Participant left: %s (reason: %s)", participant.get("id", "unknown"), reason)
        # Post transcript and complete session
        messages_to_post = transcript.get_messages()
        if messages_to_post:
            await mg_client.add_messages(session_id, messages_to_post)
            logger.info("Posted %d messages to session %s", len(messages_to_post), session_id)
        await mg_client.complete_session(session_id)
        await task.queue_frame(EndFrame())

    # --- Run ---
    runner = PipelineRunner()
    await runner.run(task)


if __name__ == "__main__":
    asyncio.run(main())
