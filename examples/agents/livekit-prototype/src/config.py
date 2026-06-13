"""Env-var loading for the LiveKit prototype.

Kept dead simple: no async validation, no MCP discovery, no defaults that
hide misconfiguration. The whole point of the prototype is to show how
little setup an agent needs to come online and pull its prompt from
ModelGuide. Anything fancy lives in the BuildPro example.
"""

import os

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    """Raised when a required env var is missing."""


# ---------------------------------------------------------------------------
# Required — validate() raises if any are missing
# ---------------------------------------------------------------------------

REQUIRED = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


# Set at import time so WorkerOptions can read it
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prototype")

# Populated by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
ELEVENLABS_VOICE_ID: str = "iP95p4xoKVk53GoZ742B"
USER_EMAIL: str = "voice-caller"
FALLBACK_PROMPT: str = (
    "You are a friendly voice assistant. The operator has not finished "
    "compiling your prompt yet — ask the caller to retry in a moment."
)


_validated = False


def validate() -> None:
    """Populate module-level constants from the environment.

    Safe to call multiple times. Idempotent.
    """
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED if not os.getenv(v)]
    if missing:
        raise ConfigError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    g = globals()
    g.update({
        "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
        "ELEVENLABS_API_KEY": os.environ["ELEVENLABS_API_KEY"],
        "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
        "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
        "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
        "ELEVENLABS_VOICE_ID": os.getenv(
            "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
        ),
        "USER_EMAIL": os.getenv("USER_EMAIL", "voice-caller"),
        "FALLBACK_PROMPT": os.getenv("FALLBACK_PROMPT", FALLBACK_PROMPT),
    })

    _validated = True
