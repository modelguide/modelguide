"""Environment variables for the LiveKit prototype agent.

Inspired by voiceblox: keep config flat, validate at entrypoint, fail fast.
Compared with the BuildPro agent in ``examples/agents/livekit-agent`` this
file omits everything tied to MCP tool discovery, Langfuse and SIP — the
prototype is conversation-only on purpose.
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")
load_dotenv()


class ConfigError(RuntimeError):
    pass


# Read at import time — used by WorkerOptions before validate() runs. The
# voice-test dispatch metadata carries ``agentName = <agent slug>`` so the
# default here only matters for the standalone ``dev`` / ``console`` flows.
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prototype")

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]

OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
ELEVENLABS_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

GREETING: str = (
    "Hi there — I'm running on the latest prompt from ModelGuide. "
    "What can I help with?"
)

_validated = False


def validate() -> None:
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(
            "Missing required environment variables: " + ", ".join(missing)
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
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "GREETING": os.getenv(
                "GREETING",
                "Hi there — I'm running on the latest prompt from ModelGuide. "
                "What can I help with?",
            ),
        }
    )

    _validated = True
