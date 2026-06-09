"""Environment variable loading and validation for the POC LiveKit agent.

The POC is intentionally small: one connector-free, conversation-only
agent that pulls its system prompt + prompt config from ModelGuide at
session start, so editing the prompt + clicking "Talk to agent" runs
the new version without redeploying the worker.

`AGENT_NAME` is read at import time so it can be passed to
`agents.WorkerOptions` before `validate()` runs. Everything else is
loaded on `validate()` so the LiveKit worker process can boot even when
secrets are missing (errors then surface as a 5xx on the first call
rather than crashing the worker at import time).
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


# Read at import time — WorkerOptions needs this before validate().
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-poc")

# Populated by validate()
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
    g.update(
        {
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
        }
    )

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
