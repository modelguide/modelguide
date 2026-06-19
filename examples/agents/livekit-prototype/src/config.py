"""Environment configuration for the prototype voice worker.

Intentionally minimal: this worker has no MCP client, no SOPs, no tools.
Just LLM + STT + TTS credentials and the LiveKit worker identity.
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")

load_dotenv()


class ConfigError(RuntimeError):
    pass


AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prototype")

OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""

LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
ELEVENLABS_VOICE_ID: str = ""

_REQUIRED = ("OPENAI_API_KEY", "DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY")

_validated = False


def validate() -> None:
    """Populate module-level constants. Idempotent."""
    global _validated
    if _validated:
        return

    missing = [v for v in _REQUIRED if not os.getenv(v)]
    if missing:
        raise ConfigError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    g = globals()
    g.update(
        {
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
            "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
            "ELEVENLABS_API_KEY": os.environ["ELEVENLABS_API_KEY"],
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
        }
    )

    _validated = True
