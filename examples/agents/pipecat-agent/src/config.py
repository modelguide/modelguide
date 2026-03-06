"""Environment variable loading and validation."""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

REQUIRED_VARS = [
    "DAILY_API_KEY",
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "CARTESIA_API_KEY",
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

DAILY_API_KEY: str = _env["DAILY_API_KEY"]
OPENAI_API_KEY: str = _env["OPENAI_API_KEY"]
DEEPGRAM_API_KEY: str = _env["DEEPGRAM_API_KEY"]
CARTESIA_API_KEY: str = _env["CARTESIA_API_KEY"]
MODELGUIDE_API_URL: str = _env["MODELGUIDE_API_URL"].rstrip("/")
MODELGUIDE_API_KEY: str = _env["MODELGUIDE_API_KEY"]
MODELGUIDE_AGENT_ID: str = _env["MODELGUIDE_AGENT_ID"]
CARTESIA_VOICE_ID: str = os.getenv("CARTESIA_VOICE_ID", "79a125e8-cd45-4c13-8a67-188112f4dd22")
