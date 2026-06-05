"""Environment configuration for the LiveKit prompt-POC worker.

Mirrors the validation pattern from the buildpro example so the worker can
start its WorkerOptions before the env is fully validated, then call
``validate()`` once inside the entrypoint.
"""

from __future__ import annotations

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


# Read at import time — WorkerOptions needs AGENT_NAME before validate() runs.
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prompt-poc")

# Populated by validate().
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
ELEVENLABS_VOICE_ID: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
GREETING: str = "Hi — I'm using my latest compiled prompt. What can I help with?"

_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants."""
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
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "GREETING": os.getenv(
                "GREETING",
                "Hi — I'm using my latest compiled prompt. What can I help with?",
            ),
        }
    )

    if not g["ELEVENLABS_API_KEY"]:
        raise ConfigError("ELEVENLABS_API_KEY is required for TTS in this POC")

    _validated = True
