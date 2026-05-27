"""Fetches the agent's compiled system prompt from ModelGuide at session start.

Why this exists
---------------
The buildpro example bakes its system prompt into the worker image
(``src/prompts/``). That means an admin who edits a SOP and clicks
"Compile" in the dashboard can't actually hear the difference until the
worker is redeployed — defeating the whole point of having a one-click
"Talk to agent" loop.

This module flips that: every time a session starts, we ``GET
/api/agents/me`` with the worker's own API key, read the live
``compiledInstructions``, and use that string as the LLM's system
prompt. Click compile → click "Talk to agent" → hear the change.

Failure handling
----------------
A voice call is already in flight in the operator's browser by the time
this runs. Crashing here means dead air. So:

- API down → ``load_prompt`` returns ``FALLBACK_PROMPT`` and logs loudly
- Compiled prompt missing → same fallback (the operator can still talk
  to the agent and hear that "no prompt is configured")
- ``fetch_agent_profile`` still raises ``PromptLoadError`` for callers
  that need to know — ``load_prompt`` is the consumer-friendly wrapper.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger("prompt_loader")


# Spoken-aloud fallback. Deliberately verbose: the operator should hear
# WHY they got the fallback instead of silently getting some generic
# default that looks like the real prompt.
FALLBACK_PROMPT = (
    "You are a voice assistant for a ModelGuide-powered agent. "
    "No compiled prompt was returned by the ModelGuide API for this agent. "
    "Tell the caller: 'I'm running on the fallback prompt because I couldn't "
    "load my instructions. Please compile a prompt in the dashboard and try "
    "again.' Be brief and stay in this fallback mode."
)


class PromptLoadError(RuntimeError):
    """Raised when the agent profile cannot be fetched from ModelGuide."""


@dataclass(frozen=True)
class AgentProfile:
    """Just enough of the ``/api/agents/me`` payload for the worker to run.

    We intentionally don't model the whole response — keeping the surface
    small means a new optional field on the API side doesn't break this
    client.
    """

    id: str
    slug: str
    name: str
    compiled_prompt: Optional[str]
    is_active: bool


async def fetch_agent_profile(
    client: httpx.AsyncClient,
    *,
    api_url: str,
    api_key: str,
) -> AgentProfile:
    """Fetch the calling agent's profile via ``GET /api/agents/me``.

    Raises ``PromptLoadError`` on any non-2xx response or transport
    failure. Caller decides whether to recover (use ``load_prompt`` for
    the recover-and-fall-back behavior).
    """
    url = f"{api_url.rstrip('/')}/api/agents/me"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        response = await client.get(url, headers=headers, timeout=10.0)
    except httpx.HTTPError as e:
        raise PromptLoadError(f"transport error calling {url}: {e}") from e

    if response.status_code != 200:
        raise PromptLoadError(
            f"GET {url} returned {response.status_code}: {response.text[:200]}"
        )

    try:
        body = response.json()
    except ValueError as e:
        raise PromptLoadError(f"invalid JSON from {url}: {e}") from e

    return AgentProfile(
        id=body["id"],
        slug=body["slug"],
        name=body["name"],
        compiled_prompt=body.get("compiledInstructions"),
        is_active=body.get("isActive", False),
    )


async def load_prompt(
    client: httpx.AsyncClient,
    *,
    api_url: str,
    api_key: str,
) -> str:
    """Return the system prompt the LLM should use for this session.

    Never raises. Returns ``FALLBACK_PROMPT`` when anything goes wrong so
    the operator hears a clear message instead of dead air.
    """
    try:
        profile = await fetch_agent_profile(
            client, api_url=api_url, api_key=api_key
        )
    except PromptLoadError as e:
        logger.error("Failed to load compiled prompt — using fallback: %s", e)
        return FALLBACK_PROMPT

    compiled = (profile.compiled_prompt or "").strip()
    if not compiled:
        logger.warning(
            "Agent %s (%s) has no compiled prompt — using fallback",
            profile.slug,
            profile.id,
        )
        return FALLBACK_PROMPT

    logger.info(
        "Loaded compiled prompt for agent %s (%s, %d chars)",
        profile.slug,
        profile.id,
        len(compiled),
    )
    return compiled
