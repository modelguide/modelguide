"""Environment variable loading and validation.

AGENT_NAME is read at import time (the LiveKit worker registers itself
under that name before ``validate()`` runs). Everything else is set up
by ``validate()`` so the worker process can boot far enough to log a
useful error when env vars are missing — instead of crashing during
module import with a stack trace nobody reads.
"""

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")

load_dotenv()

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


# Read at import time — the LiveKit worker needs this to register
# itself. If unset, the worker will use the literal string below;
# anything that dispatches to a different agent name simply won't reach
# this worker.
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prompt-test")

# Filled in by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
CARTESIA_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
TTS_PROVIDER: str = "elevenlabs"
ELEVENLABS_VOICE_ID: str = ""
CARTESIA_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
USER_EMAIL: str = ""

GREETING: str = ""


_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants.

    Safe to call multiple times — only runs once.
    """
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    g = globals()
    g.update({
        "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
        "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
        "TTS_PROVIDER": os.getenv("TTS_PROVIDER", "elevenlabs"),
        "ELEVENLABS_VOICE_ID": os.getenv(
            "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
        ),
        "CARTESIA_VOICE_ID": os.getenv(
            "CARTESIA_VOICE_ID", "a167e0f3-df7e-4d52-a9c3-f949145571bd"
        ),
        "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
        "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
        "USER_EMAIL": os.getenv("USER_EMAIL", "voice-caller"),
        "GREETING": os.getenv(
            "GREETING",
            "Hi — what can I help you with today?",
        ),
    })

    tts = g["TTS_PROVIDER"]
    if tts == "cartesia" and not g["CARTESIA_API_KEY"]:
        raise ConfigError(
            "TTS_PROVIDER=cartesia but CARTESIA_API_KEY is not set"
        )
    if tts == "elevenlabs" and not g["ELEVENLABS_API_KEY"]:
        raise ConfigError(
            "TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set"
        )

    _validated = True
