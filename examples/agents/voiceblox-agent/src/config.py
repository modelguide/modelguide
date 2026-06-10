"""Environment configuration for the voiceblox prototype agent.

Inspired by https://github.com/voiceblox-ai/voiceblox: a runtime where the
agent's behaviour is driven by *configuration*, not by code committed to the
worker image. Specifically:

  * The system prompt is fetched from the ModelGuide API on every session
    start (see ``mg_client.fetch_runtime``). Editing the prompt in the
    dashboard takes effect on the *next* call — no worker redeploy needed.
  * STT / TTS / LLM choices are env-only knobs, never embedded in code.

Validation is deferred so the LiveKit worker process can start before the
env is checked. Call ``validate()`` once at the top of the entrypoint; after
that the module-level constants are safe to read.
"""

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("voiceblox.config")

load_dotenv()

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


# Read at import time so WorkerOptions(agent_name=...) works before validate.
AGENT_NAME: str = os.getenv("AGENT_NAME", "voiceblox-prototype")

# All other config is populated by validate().
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""

LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
TTS_PROVIDER: str = "elevenlabs"
ELEVENLABS_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

# Fallback prompt when the agent has not been compiled in the dashboard yet.
# Kept short on purpose — if you see this in production it means the operator
# forgot to compile a prompt, and the agent should make that obvious rather
# than pretending it knows the business.
FALLBACK_PROMPT: str = (
    "You are a voice assistant connected to ModelGuide. The operator has not "
    "compiled a system prompt for this agent yet — politely tell the caller "
    "you're not configured and end the call."
)

# Spoken when the agent joins a room. {name} is interpolated from the caller's
# identity. Override per-deployment with VOICEBLOX_GREETING.
GREETING: str = "Hey {name} — how can I help?"


_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants.

    Idempotent — safe to call multiple times.
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
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
            "TTS_PROVIDER": os.getenv("TTS_PROVIDER", "elevenlabs"),
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "GREETING": os.getenv("VOICEBLOX_GREETING", GREETING),
        }
    )

    tts = g["TTS_PROVIDER"]
    if tts == "elevenlabs" and not g["ELEVENLABS_API_KEY"]:
        raise ConfigError(
            "TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set"
        )

    _validated = True
