"""Environment configuration for the LiveKit POC agent (ADR-015).

Kept deliberately small — no provider toggles, no SIP, no langfuse. The
POC's only job is to demonstrate that a worker can fetch the live compiled
prompt from ModelGuide and use it to drive an AgentSession.

``AGENT_NAME`` is read at import time because LiveKit's ``WorkerOptions``
needs it before ``validate()`` runs. Everything else is populated by
``validate()``.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    """Raised when required env vars are missing or malformed."""


REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]

# Read at import time — WorkerOptions captures this before validate() runs.
AGENT_NAME: str = os.getenv("AGENT_NAME", "mg-poc-agent")

# All other config — values populated by validate().
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
ELEVENLABS_VOICE_ID: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

FALLBACK_INSTRUCTIONS: str = ""
FALLBACK_GREETING: str = ""

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
            f"Missing required environment variables: {', '.join(missing)}",
        )

    g = globals()
    g.update({
        "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
        "ELEVENLABS_API_KEY": os.environ["ELEVENLABS_API_KEY"],
        "ELEVENLABS_VOICE_ID": os.getenv(
            "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B",
        ),
        "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
        "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
        "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
        "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
        "FALLBACK_INSTRUCTIONS": os.getenv(
            "FALLBACK_INSTRUCTIONS",
            "You are a helpful voice assistant. Keep replies short.",
        ),
        "FALLBACK_GREETING": os.getenv(
            "FALLBACK_GREETING",
            "Hi! No prompt is compiled yet — once you compile one in the "
            "dashboard, I'll pick it up on the next call.",
        ),
    })

    _validated = True
