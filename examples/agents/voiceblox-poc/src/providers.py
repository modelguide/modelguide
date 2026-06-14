"""STT and TTS provider factories.

The POC uses Deepgram Nova-3 + ElevenLabs Flash v2.5 — same defaults as
the buildpro example so we get the same latency profile. Swap providers
by editing this file rather than wiring a config matrix.
"""

from __future__ import annotations

import logging

import config

logger = logging.getLogger("providers")


def create_stt():
    from livekit.plugins import deepgram

    logger.info("STT model: nova-3")
    return deepgram.STT(
        model="nova-3",
        api_key=config.DEEPGRAM_API_KEY,
        interim_results=True,
        endpointing_ms=300,
    )


def create_tts():
    from livekit.agents import tokenize
    from livekit.plugins import elevenlabs

    logger.info("TTS provider: elevenlabs (voice=%s)", config.ELEVENLABS_VOICE_ID)
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
