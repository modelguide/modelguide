"""BuildPro "Sam" system prompt — base + workflows composed at build time."""

from prompts.base import PROMPT as BASE_PROMPT
from prompts.workflows import load_all as _load_workflows

_WORKFLOW_PROMPTS = _load_workflows()

SYSTEM_PROMPT_TEMPLATE = BASE_PROMPT + "\n\n# Workflows\n\n" + "\n\n".join(_WORKFLOW_PROMPTS)

# TTS greeting — spoken immediately before LLM is invoked.
# Must match the greeting instruction in base.py.
GREETING = "Hey {name} — what do you need?"


def build_system_prompt(
    session_id: str,
    user_email: str = "voice-caller",
    channel: str = "voice",
    order_id: str = "",
) -> str:
    """Interpolate runtime values into the system prompt."""
    return (
        SYSTEM_PROMPT_TEMPLATE
        .replace("{{mg_session_id}}", session_id)
        .replace("{{userEmail}}", user_email)
        .replace("{{channel}}", channel)
        .replace("{{orderId}}", order_id)
    )
