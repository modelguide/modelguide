"""Environment variable loading and validation.

Validation is deferred so the LiveKit agent can start its worker process
before env vars are checked.  Call ``validate()`` once at the top of the
entrypoint — after that the module-level constants are safe to read.

AGENT_NAME and CONNECTOR_PREFIX are read at import time (needed for
WorkerOptions before validate() runs). All other vars require validate().
"""

import asyncio
import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")

load_dotenv()

# ---------------------------------------------------------------------------
# Required vars — validate() raises if any are missing
# ---------------------------------------------------------------------------

REQUIRED_VARS = [
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "MODELGUIDE_API_URL",
    "MODELGUIDE_API_KEY",
    "MODELGUIDE_AGENT_ID",
]


class ConfigError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Agent identity — read at import time (used by WorkerOptions before validate)
# ---------------------------------------------------------------------------

AGENT_NAME: str = os.getenv("AGENT_NAME", "buildpro-sam")
CONNECTOR_PREFIX: str = os.getenv("CONNECTOR_PREFIX", "glowbox_store")

# ---------------------------------------------------------------------------
# All other config — values set by validate()
# ---------------------------------------------------------------------------

# LLM / STT / TTS
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
CARTESIA_API_KEY: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
STT_MODEL: str = "nova-3"
TTS_PROVIDER: str = "elevenlabs"
ELEVENLABS_VOICE_ID: str = ""
CARTESIA_VOICE_ID: str = ""

# ModelGuide
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
MODELGUIDE_AGENT_ID: str = ""
USER_EMAIL: str = ""

# Observability
LANGFUSE_PUBLIC_KEY: str = ""
LANGFUSE_SECRET_KEY: str = ""
LANGFUSE_HOST: str = "https://cloud.langfuse.com"

# Stubbed tools (comma-separated names with no MCP backend yet — returns fake success)
STUBBED_TOOLS: str = "send_email"

# Other
GOOGLE_API_KEY: str = ""
REGION: str = "us"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants.

    Safe to call multiple times — only runs once.
    """
    global _validated
    if _validated:
        return

    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(f"Missing required environment variables: {', '.join(missing)}")

    g = globals()
    g.update({
        # LLM / STT / TTS
        "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        "DEEPGRAM_API_KEY": os.environ["DEEPGRAM_API_KEY"],
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        "LLM_MODEL": os.getenv("LLM_MODEL", "gpt-4.1-mini"),
        "STT_MODEL": os.getenv("STT_MODEL", "nova-3"),
        "TTS_PROVIDER": os.getenv("TTS_PROVIDER", "elevenlabs"),
        "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B"),
        "CARTESIA_VOICE_ID": os.getenv("CARTESIA_VOICE_ID", "a167e0f3-df7e-4d52-a9c3-f949145571bd"),
        # ModelGuide
        "MODELGUIDE_API_URL": os.environ["MODELGUIDE_API_URL"].rstrip("/"),
        "MODELGUIDE_API_KEY": os.environ["MODELGUIDE_API_KEY"],
        "MODELGUIDE_AGENT_ID": os.environ["MODELGUIDE_AGENT_ID"],
        "USER_EMAIL": os.getenv("USER_EMAIL", "voice-caller"),
        # Observability
        "LANGFUSE_PUBLIC_KEY": os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        "LANGFUSE_SECRET_KEY": os.getenv("LANGFUSE_SECRET_KEY", ""),
        "LANGFUSE_HOST": os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        # Stubbed tools
        "STUBBED_TOOLS": os.getenv("STUBBED_TOOLS", "send_email"),
        # Other
        "GOOGLE_API_KEY": os.getenv("GOOGLE_API_KEY", ""),
        "REGION": os.getenv("REGION", "us"),
    })

    # Validate TTS provider has its API key
    tts = g["TTS_PROVIDER"]
    if tts == "cartesia" and not g["CARTESIA_API_KEY"]:
        raise ConfigError("TTS_PROVIDER=cartesia but CARTESIA_API_KEY is not set")
    if tts == "elevenlabs" and not g["ELEVENLABS_API_KEY"]:
        raise ConfigError("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set")

    _validated = True

    # Validate MCP tools (fire-and-forget, don't block startup)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_validate_mcp_tools())
    except RuntimeError:
        # No running loop — skip async validation (e.g. during tests)
        pass


async def _validate_mcp_tools() -> None:
    """Discover MCP tools and log any mismatches with our tool map."""
    try:
        import mg_client
        from buildpro import BuildProAgent

        mcp_tools = await mg_client.list_tools()
        mcp_names = {t["name"] for t in mcp_tools}
        logger.info("MCP tools discovered: %s", ", ".join(sorted(mcp_names)))

        for short_name in BuildProAgent.TOOL_NAMES:
            mcp_name = f"{CONNECTOR_PREFIX}_{short_name}"
            if mcp_name not in mcp_names:
                logger.warning("Tool %s (%s) NOT found in MCP — calls will fail", short_name, mcp_name)
    except Exception:
        logger.exception(
            "Failed to discover MCP tools — MODELGUIDE_API_KEY may be invalid or agent inactive"
        )
