"""Environment variable loading for the LiveKit prototype agent.

Only three variables are required. Everything else (LiveKit URL/keys, model,
voice, etc.) is injected by LiveKit Cloud or carried through dispatch metadata
— the prototype's whole point is that the *prompt* lives in ModelGuide, not in
config.
"""

import os

from dotenv import load_dotenv

load_dotenv()


class ConfigError(RuntimeError):
    pass


# Read at import time so WorkerOptions can use AGENT_NAME before validate().
AGENT_NAME: str = os.getenv("AGENT_NAME", "modelguide-prototype")

# Set by validate() at entrypoint time.
OPENAI_API_KEY: str = ""
LLM_MODEL: str = "gpt-4o-realtime-preview"
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""

REQUIRED_VARS = ["OPENAI_API_KEY", "MODELGUIDE_API_URL", "MODELGUIDE_API_KEY"]

_validated = False


def validate() -> None:
    """Populate module-level constants from os.environ. Idempotent."""
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
            "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4o-realtime-preview"),
            "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
            "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
        }
    )

    _validated = True
