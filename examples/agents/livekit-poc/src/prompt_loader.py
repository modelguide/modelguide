"""Fetch the latest compiled prompt for a ModelGuide agent.

The POC's whole reason to exist is "always boot with the freshest prompt
the operator just compiled in the dashboard." The flow at session start:

  1. ``extract_agent_id(metadata)`` — pull the UUID the API stamped into
     the LiveKit dispatch metadata.
  2. ``load_prompt(agent_id)`` — call ``GET /api/agents/{agent_id}`` and
     return its ``compiledInstructions``.
  3. If the API fails or the agent hasn't been compiled yet, return a
     clearly-labelled fallback so the room still produces audio (a silent
     room is the worst feedback for an operator iterating on prompts).

This file does NOT depend on livekit / livekit-agents so the tests can
exercise it without bringing up the worker.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx

import config

logger = logging.getLogger("prompt_loader")


PromptSource = Literal["modelguide-api", "fallback"]


@dataclass(frozen=True)
class PromptResult:
    text: str
    source: PromptSource
    agent_id: str | None


FALLBACK_PROMPT = (
    "You are a helpful voice assistant in a ModelGuide POC session. "
    "The agent's compiled prompt could not be loaded — most likely the "
    "operator hasn't clicked Compile in the dashboard yet, or the "
    "ModelGuide API is unreachable. Greet the caller, tell them the "
    "fallback prompt is in use, and ask them to retry after compiling. "
    "Keep responses short."
)


def extract_agent_id(metadata: Any) -> str | None:
    """Return the ``agent_id`` field of dispatch metadata, or None.

    Accepts non-dict inputs (returns None) because LiveKit ``console`` mode
    dispatches with no metadata at all and we don't want the entrypoint to
    have to special-case that.
    """
    if not isinstance(metadata, dict):
        return None
    value = metadata.get("agent_id")
    if not isinstance(value, str) or not value:
        return None
    return value


async def _http_get(url: str, *, headers: dict[str, str]) -> httpx.Response:
    """Tiny indirection so tests can patch the HTTP layer without mocking httpx itself."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response


async def load_prompt(agent_id: str | None) -> PromptResult:
    """Fetch ``compiledInstructions`` for ``agent_id`` or return the fallback.

    Never raises — a session that can't load a prompt should still produce
    audio so the operator sees the worker dispatched correctly and knows
    to compile (or fix the API connection).
    """
    if not agent_id:
        logger.warning("No agent_id provided — using fallback prompt")
        return PromptResult(text=FALLBACK_PROMPT, source="fallback", agent_id=None)

    url = f"{config.MODELGUIDE_API_URL}/api/agents/{agent_id}"
    headers = {
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
        "Accept": "application/json",
    }

    try:
        response = await _http_get(url, headers=headers)
        body = response.json()
    except Exception as exc:  # noqa: BLE001 — fallback is the whole point
        logger.warning("Failed to fetch agent %s: %s — using fallback", agent_id, exc)
        return PromptResult(
            text=FALLBACK_PROMPT, source="fallback", agent_id=agent_id
        )

    compiled = body.get("compiledInstructions")
    if not isinstance(compiled, str) or not compiled.strip():
        logger.info(
            "Agent %s has no compiledInstructions (compile never run?) — using fallback",
            agent_id,
        )
        return PromptResult(
            text=FALLBACK_PROMPT, source="fallback", agent_id=agent_id
        )

    logger.info(
        "Loaded compiled prompt for agent %s (%d chars)", agent_id, len(compiled)
    )
    return PromptResult(
        text=compiled, source="modelguide-api", agent_id=agent_id
    )
