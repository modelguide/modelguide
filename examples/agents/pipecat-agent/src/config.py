"""Environment variable loading and validation."""

import os

from dotenv import load_dotenv

load_dotenv()

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
    "MODELGUIDE_AGENT_ID",
]


class ConfigError(RuntimeError):
    pass


def _validate() -> dict[str, str]:
    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(f"Missing required environment variables: {', '.join(missing)}")
    return {v: os.environ[v] for v in REQUIRED_VARS}


_env = _validate()

# Provided by Pipecat Cloud managed keys, or set manually for local dev
DAILY_API_KEY: str = os.getenv("DAILY_API_KEY", "")
OPENAI_API_KEY: str = _env["OPENAI_API_KEY"]
DEEPGRAM_API_KEY: str = _env["DEEPGRAM_API_KEY"]
ELEVENLABS_API_KEY: str = _env["ELEVENLABS_API_KEY"]
MODELGUIDE_API_URL: str = _env["MODELGUIDE_API_URL"].rstrip("/")
MODELGUIDE_API_KEY: str = _env["MODELGUIDE_API_KEY"]
MODELGUIDE_AGENT_ID: str = _env["MODELGUIDE_AGENT_ID"]
# Default: ElevenLabs "Chris" voice
ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B")
USER_EMAIL: str = os.getenv("USER_EMAIL", "voice-caller")
