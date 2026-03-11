"""Environment variable loading and validation.

Validation is deferred so the LiveKit agent can start its worker process
before env vars are checked.  Call ``validate()`` once at the top of the
entrypoint — after that the module-level constants are safe to read.

MCP tool discovery runs once at validate() time and logs missing tools.
"""

import asyncio
import logging
import os

from dotenv import load_dotenv

logger = logging.getLogger("config")

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


_validated = False


def validate() -> None:
    """Validate required env vars and populate module-level constants.

    Safe to call multiple times — only runs once.
    """
    global _validated
    global OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY
    global MODELGUIDE_API_URL, MODELGUIDE_API_KEY, MODELGUIDE_AGENT_ID
    global ELEVENLABS_VOICE_ID, GOOGLE_API_KEY, USER_EMAIL, LLM_MODEL

    if _validated:
        return

    missing = [v for v in REQUIRED_VARS if not os.getenv(v)]
    if missing:
        raise ConfigError(f"Missing required environment variables: {', '.join(missing)}")

    OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
    DEEPGRAM_API_KEY = os.environ["DEEPGRAM_API_KEY"]
    ELEVENLABS_API_KEY = os.environ["ELEVENLABS_API_KEY"]
    MODELGUIDE_API_URL = os.environ["MODELGUIDE_API_URL"].rstrip("/")
    MODELGUIDE_API_KEY = os.environ["MODELGUIDE_API_KEY"]
    MODELGUIDE_AGENT_ID = os.environ["MODELGUIDE_AGENT_ID"]
    ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "iP95p4xoKVk53GoZ742B")
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
    USER_EMAIL = os.getenv("USER_EMAIL", "voice-caller")
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")

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
        from agent import TOOL_NAME_MAP

        mcp_tools = await mg_client.list_tools()
        mcp_names = {t["name"] for t in mcp_tools}
        logger.info("MCP tools discovered: %s", ", ".join(sorted(mcp_names)))

        for short_name, mcp_name in TOOL_NAME_MAP.items():
            if mcp_name not in mcp_names:
                logger.warning("Tool %s (%s) NOT found in MCP — calls will fail", short_name, mcp_name)
    except Exception:
        logger.exception(
            "Failed to discover MCP tools — MODELGUIDE_API_KEY may be invalid or agent inactive"
        )


# Declare module-level names so imports don't fail — values set by validate()
OPENAI_API_KEY: str = ""
DEEPGRAM_API_KEY: str = ""
ELEVENLABS_API_KEY: str = ""
MODELGUIDE_API_URL: str = ""
MODELGUIDE_API_KEY: str = ""
MODELGUIDE_AGENT_ID: str = ""
ELEVENLABS_VOICE_ID: str = ""
GOOGLE_API_KEY: str = ""
USER_EMAIL: str = ""
LLM_MODEL: str = "gpt-4.1-mini"
