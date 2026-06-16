"""Environment variable loading and validation.

Required vars are enforced by ``validate()``, called once from the
LiveKit entrypoint. The optional ``MODELGUIDE_AGENT_ID`` is the
fallback used when the dispatch metadata doesn't carry an ``agent_id``
(e.g. running ``python src/agent.py console`` for a quick local check).
"""

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")

load_dotenv()


# --------------------------------------------------------------------------- #
# Identity — read at import time so WorkerOptions can be constructed before
# any other init.
# --------------------------------------------------------------------------- #

AGENT_NAME: str = os.getenv("AGENT_NAME", "livekit-poc")


# --------------------------------------------------------------------------- #
# Required vars
# --------------------------------------------------------------------------- #

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# All other config — populated by validate()
# --------------------------------------------------------------------------- #

OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
ELEVENLABS_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
MODELGUIDE_AGENT_ID: str = ""  # optional — fallback when dispatch metadata is empty
USER_EMAIL: str = "voice-caller"


_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants.

    Idempotent — second and later calls are no-ops so tests / hot reload
    don't trigger re-reads.
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
            "ELEVENLABS_API_KEY": os.environ["ELEVENLABS_API_KEY"],
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
            # Strip trailing slash once — mg_client builds URLs by string
            # concatenation and a `//api/...` path produces a 404.
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "MODELGUIDE_AGENT_ID": os.getenv("MODELGUIDE_AGENT_ID", ""),
            "USER_EMAIL": os.getenv("USER_EMAIL", "voice-caller"),
        }
    )

    _validated = True
