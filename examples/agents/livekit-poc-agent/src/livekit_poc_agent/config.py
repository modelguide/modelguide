"""Environment configuration for the POC LiveKit agent.

Validation is deferred so the LiveKit worker process can boot before env
vars are checked. Call ``validate()`` once at the top of the entrypoint.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


REQUIRED = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    """Raised when required env vars are missing."""


# Read at import time — used by WorkerOptions before validate() runs.
AGENT_NAME: str = os.getenv("AGENT_NAME", "livekit-poc-agent")

# All other config — populated by validate().
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
LLM_MODEL: str = ""
ELEVENLABS_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

# Fallback prompt used when the agent has not been compiled yet in the
# dashboard. The whole point of the POC is to override this with the
# user's compiled prompt — but we must still complete the call gracefully
# if compile has never been clicked.
FALLBACK_INSTRUCTIONS: str = (
    "You are a friendly voice assistant. Greet the caller, listen, and "
    "respond conversationally. If you do not know the answer, say so."
)


_validated = False


def validate() -> None:
    """Load env vars and raise on any missing required value."""
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED if not os.getenv(v)]
    if missing:
        raise ConfigError(f"Missing required env vars: {', '.join(missing)}")

    g = globals()
    g.update(
        {
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
            "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
            "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "FALLBACK_INSTRUCTIONS": os.getenv(
                "FALLBACK_INSTRUCTIONS", FALLBACK_INSTRUCTIONS
            ),
        }
    )
    _validated = True
