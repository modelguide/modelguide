"""Pull the latest compiled prompt from ModelGuide at session start.

Why this exists
---------------
The classic LiveKit worker bakes its prompt into the image. That makes
"compile in the dashboard → talk to the agent" a deploy cycle, which is
painful while iterating on instructions.

This fetcher trades that off: we pay one HTTP round-trip per room (single
~50ms call to the ModelGuide REST API, already on the same critical path as
the LiveKit join) in exchange for prompts that are always fresh.

Failure mode
------------
If the control-plane is unreachable, returns an empty/stub prompt and marks
``is_fallback=True`` so the caller can log it loudly. Crucially we never
raise — a flapping API endpoint shouldn't take voice calls down with it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("prompt_fetcher")

PROMPT_ENDPOINT = "/api/agents/me/prompt"

DEFAULT_FALLBACK_INSTRUCTIONS = (
    "You are a helpful voice assistant. The operator has not finished "
    "configuring your prompt yet. Greet the caller, briefly explain that "
    "you are running in a default mode, and answer questions as best you "
    "can."
)


@dataclass(frozen=True)
class FetchedPrompt:
    """Result of one prompt fetch."""

    instructions: str
    is_fallback: bool
    compiled_at: str | None = None
    agent_id: str | None = None
    agent_slug: str | None = None
    agent_name: str | None = None
    prompt_config: dict[str, Any] = field(default_factory=dict)


class PromptFetcher:
    """Thin wrapper over an authenticated httpx client."""

    def __init__(self, client: httpx.AsyncClient):
        self._client = client

    async def fetch(self) -> FetchedPrompt:
        try:
            resp = await self._client.get(PROMPT_ENDPOINT)
        except httpx.HTTPError as exc:
            logger.warning("Prompt fetch network error: %s — using fallback", exc)
            return _fallback(reason="network_error")

        if resp.status_code != 200:
            logger.warning(
                "Prompt fetch returned HTTP %d — using fallback (body: %s)",
                resp.status_code,
                resp.text[:200],
            )
            return _fallback(reason=f"http_{resp.status_code}")

        try:
            data = resp.json()
        except ValueError as exc:
            logger.warning("Prompt fetch malformed JSON: %s — using fallback", exc)
            return _fallback(reason="malformed_json")

        agent = data.get("agent") or {}
        compiled = data.get("compiledInstructions")

        if not compiled:
            # Agent exists but hasn't been compiled yet. Return identity
            # info so the operator sees "fallback for <name>" in logs, but
            # use the stub instructions until they click Compile.
            return FetchedPrompt(
                instructions=DEFAULT_FALLBACK_INSTRUCTIONS,
                is_fallback=True,
                compiled_at=None,
                agent_id=agent.get("id"),
                agent_slug=agent.get("slug"),
                agent_name=agent.get("name"),
                prompt_config=data.get("promptConfig") or {},
            )

        return FetchedPrompt(
            instructions=compiled,
            is_fallback=False,
            compiled_at=data.get("compiledAt"),
            agent_id=agent.get("id"),
            agent_slug=agent.get("slug"),
            agent_name=agent.get("name"),
            prompt_config=data.get("promptConfig") or {},
        )


def _fallback(*, reason: str) -> FetchedPrompt:
    return FetchedPrompt(
        instructions=DEFAULT_FALLBACK_INSTRUCTIONS,
        is_fallback=True,
        compiled_at=None,
    )


def build_authenticated_client(base_url: str, api_key: str) -> httpx.AsyncClient:
    """Standard client for production use — single connection pool per worker."""
    return httpx.AsyncClient(
        base_url=base_url,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
    )
