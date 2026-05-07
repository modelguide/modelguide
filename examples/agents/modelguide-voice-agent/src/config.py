"""Environment-variable loading.

Mirrors the layout of ``examples/agents/livekit-agent/src/config.py`` but
with a much smaller surface — this POC has no MCP tooling, no telephony,
no Langfuse. Just enough to talk to the user.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Worker identity (read at import time — needed before validate())
# ---------------------------------------------------------------------------

# `agent_name` registered with the LiveKit worker. The ModelGuide dashboard
# stores this on the agent's metadata.livekit.agentName so explicit dispatch
# can route to the correct worker.
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-voice-agent")

# ---------------------------------------------------------------------------
# Required vars — populated by validate()
# ---------------------------------------------------------------------------

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
ELEVENLABS_VOICE_ID: str = "iP95p4xoKVk53GoZ742B"
LLM_MODEL: str = "gpt-4.1-mini"

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

# Local-dev escape hatch — used when the dashboard hasn't compiled the
# agent yet. Also handy for working offline.
DEFAULT_INSTRUCTIONS: str = ""


_validated = False


def validate() -> None:
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
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", ELEVENLABS_VOICE_ID
            ),
            "LLM_MODEL": os.getenv("LLM_MODEL", LLM_MODEL),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "DEFAULT_INSTRUCTIONS": os.getenv("DEFAULT_INSTRUCTIONS", ""),
        }
    )

    _validated = True
