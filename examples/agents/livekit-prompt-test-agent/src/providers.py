"""STT and TTS provider factories.

Controlled by STT_MODEL and TTS_PROVIDER env vars in config. Mirrors
the buildpro example so a deployment switching between the two workers
only has to re-point its env vars, not relearn the provider knobs.
"""

import logging

import config

logger = logging.getLogger("providers")


def create_stt():
    """Create STT instance based on config.STT_MODEL."""
    from livekit.plugins import deepgram

    model = config.STT_MODEL
    logger.info("STT model: %s", model)

    if model == "flux":
        return deepgram.STTv2(
            model="flux-general-en",
            api_key=config.DEEPGRAM_API_KEY,
            eager_eot_threshold=0.5,
            eot_threshold=0.7,
        )

    return deepgram.STT(
        model="nova-3",
        api_key=config.DEEPGRAM_API_KEY,
        interim_results=True,
        endpointing_ms=300,
    )


def create_tts():
    """Create TTS instance based on config.TTS_PROVIDER."""
    provider = config.TTS_PROVIDER
    logger.info("TTS provider: %s", provider)

    if provider == "cartesia":
        from livekit.plugins import cartesia
        from livekit.agents import tokenize as _tokenize

        return cartesia.TTS(
            voice=config.CARTESIA_VOICE_ID,
            model="sonic-3",
            speed=1.05,
            emotion=["Conversational", "Friendly"],
            api_key=config.CARTESIA_API_KEY,
            tokenizer=_tokenize.blingfire.SentenceTokenizer(
                min_sentence_len=8,
                stream_context_len=5,
            ),
        )

    # Default: ElevenLabs
    from livekit.plugins import elevenlabs
    from livekit.agents import tokenize

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
