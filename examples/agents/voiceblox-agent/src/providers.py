"""STT and TTS provider factories.

Single-provider stack for the prototype: Deepgram Nova-3 STT, ElevenLabs
Flash v2.5 TTS. Anything more flexible (Cartesia, Flux) belongs in the
production agent.
"""

import logging

import config

logger = logging.getLogger("voiceblox.providers")


def create_stt():
    from livekit.plugins import deepgram

    logger.info("STT: deepgram %s", config.STT_MODEL)
    return deepgram.STT(
        model=config.STT_MODEL,
        api_key=config.DEEPGRAM_API_KEY,
        interim_results=True,
        endpointing_ms=300,
    )


def create_tts():
    from livekit.agents import tokenize
    from livekit.plugins import elevenlabs

    logger.info("TTS: elevenlabs voice=%s", config.ELEVENLABS_VOICE_ID)
    return elevenlabs.TTS(
        voice_id=config.ELEVENLABS_VOICE_ID,
        model="eleven_flash_v2_5",
        api_key=config.ELEVENLABS_API_KEY,
        inactivity_timeout=30,
        word_tokenizer=tokenize.blingfire.SentenceTokenizer(
            min_sentence_len=8,
            stream_context_len=5,
        ),
    )
