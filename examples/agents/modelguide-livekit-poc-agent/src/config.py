"""Environment for the POC agent.

Deliberately small surface — five required vars, four optional.  If anything
is missing, ``validate()`` raises with a single message naming the offenders
so a fresh deploy fails fast and obviously.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

REQUIRED = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


# Read at import time so livekit.agents.WorkerOptions(agent_name=...) works
# before validate() is called.
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-poc")

# Populated by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
ELEVENLABS_VOICE_ID: str = ""
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
# Greeting used when the agent has no compiled prompt yet — keeps the demo
# usable even before the operator hits Compile in the dashboard.
FALLBACK_GREETING: str = "Hi — your compiled prompt isn't loaded yet."
# Default instructions used when /me/runtime-config returns null. Lets the
# call connect and the operator hear *something* instead of dead air.
FALLBACK_INSTRUCTIONS: str = (
    "You are a helpful voice assistant. The operator has not compiled a "
    "prompt for you yet — tell them to open the dashboard, compile the "
    "agent's prompt, and try again."
)

_validated = False


def validate() -> None:
    global _validated
    if _validated:
        return
    missing = [v for v in REQUIRED if not os.getenv(v)]
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
            "ELEVENLABS_VOICE_ID": os.getenv(
                "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
            ),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
            "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
        }
    )
    _validated = True
