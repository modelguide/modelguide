"""Environment loading for the livekit-poc agent.

Kept intentionally small — the POC depends on a single LLM provider
(OpenAI) plus the LiveKit credentials needed by the worker process.
Everything else (Deepgram, ElevenLabs, Cartesia, MCP, Langfuse) is
deliberately out of scope so the prompt-iteration loop stays fast
and the agent boots from a single env file.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    """Raised when required env vars are missing at validate() time."""


# Read at import time — LiveKit's WorkerOptions need the agent name
# before the entrypoint runs.
AGENT_NAME: str = os.getenv("AGENT_NAME", "livekit-poc")

# Populated by validate(). Kept as module-level constants so the
# entrypoint can read them without passing a config dict around.
OPENAI_API_KEY: str = ""
LIVEKIT_URL: str = ""
LIVEKIT_API_KEY: str = ""
LIVEKIT_API_SECRET: str = ""

# Optional: integrate with the ModelGuide REST API. The POC works
# without these — the session is created locally on the worker side.
# When set, the worker posts the transcript on hangup.
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

# OpenAI model selection. Realtime offers the lowest latency for a
# voice-first POC and avoids the STT→LLM→TTS chain.
OPENAI_REALTIME_MODEL: str = "gpt-4o-realtime-preview"
OPENAI_REALTIME_VOICE: str = "alloy"


_REQUIRED = ["OPENAI_API_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]


_validated = False


def validate() -> None:
    """Populate module-level constants from env. Idempotent.

    Call once at the top of the entrypoint. Tests do not need to call
    this — the test conftest sets dummy values directly.
    """
    global _validated
    if _validated:
        return

    missing = [k for k in _REQUIRED if not os.getenv(k)]
    if missing:
        raise ConfigError(
            "Missing required env vars: " + ", ".join(missing)
        )

    g = globals()
    g.update(
        {
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
            "LIVEKIT_URL": os.environ["LIVEKIT_URL"],
            "LIVEKIT_API_KEY": os.environ["LIVEKIT_API_KEY"],
            "LIVEKIT_API_SECRET": os.environ["LIVEKIT_API_SECRET"],
            "MODELGUIDE_API_URL": os.getenv("MODELGUIDE_API_URL", "").rstrip("/"),
            "MODELGUIDE_API_KEY": os.getenv("MODELGUIDE_API_KEY", ""),
            "OPENAI_REALTIME_MODEL": os.getenv(
                "OPENAI_REALTIME_MODEL", "gpt-4o-realtime-preview"
            ),
            "OPENAI_REALTIME_VOICE": os.getenv("OPENAI_REALTIME_VOICE", "alloy"),
        }
    )

    _validated = True
