"""Environment loading for the livekit-prototype worker.

Only the bare minimum is required — the prompt and toolset come from
ModelGuide at runtime, so there's no per-scenario `AGENT_NAME` /
`CONNECTOR_PREFIX` coupling to configure.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Worker identity — used by LiveKit dispatch to route jobs to this worker
# ---------------------------------------------------------------------------

AGENT_NAME: str = os.getenv("AGENT_NAME", "mg-prototype")

# ---------------------------------------------------------------------------
# Required at runtime — checked by validate()
# ---------------------------------------------------------------------------

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
]


class ConfigError(RuntimeError):
    pass


# Populated by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
ELEVENLABS_VOICE_ID: str = ""

MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

# Fallback prompt used when MissingCompiledPrompt is raised. The worker
# still has to start a turn (otherwise the call sits silent), so we ship
# a tiny placeholder that tells the caller what's wrong instead.
FALLBACK_INSTRUCTIONS: str = (
    "You are a placeholder voice assistant. The operator has not yet "
    "compiled a prompt for this agent in ModelGuide. Greet the caller "
    "politely, tell them the agent's prompt has not been compiled yet, "
    "and ask them to try again after the operator clicks Compile in "
    "the dashboard."
)


_validated = False


def validate() -> None:
    """Populate module-level config from env. Idempotent."""
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    g = globals()
    g.update({
        "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
        "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
        "ELEVENLABS_VOICE_ID": os.getenv(
            "ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"
        ),
        "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
        "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
    })

    _validated = True
