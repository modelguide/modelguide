"""Voiceblox prototype agent — pulls system prompt from ModelGuide at boot.

The whole point of this prototype is to validate the "compile prompt → click
Talk to agent → speak with the new prompt immediately" loop. We do that by
having the worker call `GET /api/agents/me` at session start and using the
compiledInstructions field as the system prompt.

If the fetch fails or the agent hasn't been compiled yet, the worker falls
back to a generic default so a misconfigured agent doesn't drop the call.
"""

from __future__ import annotations

import logging
from typing import Any

from mg_client import fetch_agent_config

logger = logging.getLogger("voiceblox_agent")

DEFAULT_PROMPT = (
    "You are a friendly voice assistant. Keep responses short and natural — "
    "this is a phone call, not a chat. If you don't know something, say so."
)


PromptSource = str  # "compiled" | "fallback-uncompiled" | "fallback-error"


async def resolve_system_prompt() -> tuple[str, PromptSource]:
    """Return the system prompt to boot the agent with, and where it came from.

    Three outcomes:
    - "compiled":           ModelGuide returned a compiled prompt; use it
    - "fallback-uncompiled": agent exists but hasn't been compiled yet
    - "fallback-error":     fetch failed; use the default and log the error
    """
    try:
        cfg = await fetch_agent_config()
    except Exception:
        logger.exception("fetch_agent_config failed — using default prompt")
        return DEFAULT_PROMPT, "fallback-error"

    compiled = cfg.get("compiledInstructions")
    if not compiled:
        logger.warning(
            "Agent %s has no compiled prompt — using default",
            cfg.get("slug", "?"),
        )
        return DEFAULT_PROMPT, "fallback-uncompiled"

    prompt = compiled
    prompt_cfg = cfg.get("promptConfig") or {}
    persona = prompt_cfg.get("persona")
    language = prompt_cfg.get("language")
    extras: list[str] = []
    if persona:
        extras.append(f"# Persona\n\n{persona}")
    if language:
        extras.append(f"# Language\n\n{language}")
    if extras:
        prompt = prompt + "\n\n" + "\n\n".join(extras)

    logger.info(
        "Using compiled prompt for agent %s (%d chars)",
        cfg.get("slug", "?"),
        len(prompt),
    )
    return prompt, "compiled"


def build_greeting(agent_config: dict[str, Any] | None) -> str:
    """First line spoken to the caller. Uses agent name if we have it."""
    if agent_config and agent_config.get("name"):
        return f"Hi, this is {agent_config['name']}. How can I help?"
    return "Hi, how can I help?"
