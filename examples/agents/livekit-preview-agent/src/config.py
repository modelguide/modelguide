"""Environment-variable loading for the preview LiveKit worker.

Validation is deferred so the LiveKit worker process can start before the
env check runs. Call ``validate()`` once at the top of the entrypoint —
after that the module-level constants are safe to read.
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("preview.config")


# AGENT_NAME is read at import time because WorkerOptions needs it before
# validate() runs. This is the LiveKit worker name the *API* dispatches to
# via env.LIVEKIT_PREVIEW_AGENT_NAME — keep the defaults in lockstep.
AGENT_NAME: str = os.getenv("AGENT_NAME", "preview-worker")

# All other config: set by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
LLM_MODEL: str = ""
STT_MODEL: str = ""
TTS_VOICE_ID: str = ""

# Optional: a fallback prompt used only if a preview dispatch arrives with
# no instructions_override (shouldn't happen via the MG API path, but
# keeps the worker debuggable from `python src/agent.py console`).
FALLBACK_INSTRUCTIONS: str = (
    "You are a friendly voice agent in preview mode. The operator forgot to "
    "supply a prompt, so just acknowledge the call and ask them to compile a "
    "prompt and try again."
)


class ConfigError(RuntimeError):
    pass


def validate() -> None:
    """Populate the module-level constants from os.environ.

    Raises ``ConfigError`` listing every missing variable — failing fast
    is better than waiting for the first STT/TTS/LLM call to error out
    deep inside the agent loop.
    """
    global OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY
    global LLM_MODEL, STT_MODEL, TTS_VOICE_ID

    required = {
        "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY", ""),
        "DEEPGRAM_API_KEY": os.getenv("DEEPGRAM_API_KEY", ""),
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        raise ConfigError(
            f"Missing required env vars: {', '.join(missing)}. "
            "See README.md for the full list."
        )

    OPENAI_API_KEY = required["OPENAI_API_KEY"]
    DEEPGRAM_API_KEY = required["DEEPGRAM_API_KEY"]
    ELEVENLABS_API_KEY = required["ELEVENLABS_API_KEY"]
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")
    STT_MODEL = os.getenv("STT_MODEL", "nova-3")
    TTS_VOICE_ID = os.getenv("TTS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    logger.info(
        "preview worker config: agent_name=%s llm=%s stt=%s",
        AGENT_NAME,
        LLM_MODEL,
        STT_MODEL,
    )
