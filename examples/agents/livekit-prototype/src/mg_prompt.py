"""Fetch the calling agent's compiled prompt from ModelGuide at runtime.

The prototype's whole reason to exist is to skip the "redeploy the worker to
test a new prompt" step. Instead of baking the prompt into the worker image,
the worker calls ``GET /api/agents/me`` with its own API key at session start
and uses ``compiledInstructions`` as the system prompt.

This module is intentionally tiny and dependency-light — only ``httpx`` — so
it can be unit-tested without standing up a LiveKit worker. The contract:

    prompt = await fetch_compiled_prompt(api_url, api_key)

Returns the compiled instructions verbatim, or raises ``MissingCompiledPrompt``
if the agent has not been compiled yet. The worker layer decides what to do
when the prompt is missing (we currently fall back to a placeholder so the
agent still answers, but does so with a clear "please compile first" line).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class PromptFetchError(RuntimeError):
    """Network / 5xx / unexpected response when calling /api/agents/me."""


class PromptFetchUnauthorized(PromptFetchError):
    """API key is invalid, expired, or the agent is inactive."""


class MissingCompiledPrompt(PromptFetchError):
    """The agent record was returned but ``compiledInstructions`` is null.

    Raised so the worker can show a clear error instead of dispatching with
    an empty system prompt (which silently degrades to a generic assistant).
    """


@dataclass(frozen=True)
class AgentSelf:
    """Subset of ``GET /api/agents/me`` the worker actually consumes.

    Kept narrow so unrelated fields in the API response can change without
    breaking the prototype. If the worker starts needing a new field, add
    it here and to the parser below — both sides stay typed.
    """

    id: str
    name: str
    slug: str
    modality: str
    agent_platform: str
    is_active: bool
    compiled_instructions: str
    compiled_at: str | None


def _parse_agent_self(payload: dict[str, Any]) -> AgentSelf:
    instructions = payload.get("compiledInstructions")
    if not instructions or not isinstance(instructions, str):
        # We treat both `null` and empty string as "not compiled yet". An
        # empty string would otherwise propagate to the LLM as an empty
        # system prompt and produce a generic assistant — worse UX than
        # failing loudly.
        raise MissingCompiledPrompt(
            f"Agent {payload.get('slug', payload.get('id', '?'))} has no "
            "compiledInstructions. Compile the agent in the dashboard "
            "(Prompt → Compile) before starting a voice test."
        )
    return AgentSelf(
        id=str(payload["id"]),
        name=str(payload["name"]),
        slug=str(payload["slug"]),
        modality=str(payload["modality"]),
        agent_platform=str(payload["agentPlatform"]),
        is_active=bool(payload["isActive"]),
        compiled_instructions=instructions,
        compiled_at=payload.get("compiledAt"),
    )


async def fetch_agent_self(
    api_url: str,
    api_key: str,
    *,
    client: httpx.AsyncClient | None = None,
    timeout: float = 10.0,
) -> AgentSelf:
    """Call ``GET {api_url}/api/agents/me`` and return the parsed agent.

    ``client`` lets the worker reuse a shared httpx pool. Tests pass a
    transport-mocked client so the real network is never touched.
    """
    url = f"{api_url.rstrip('/')}/api/agents/me"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=timeout)

    try:
        resp = await client.get(url, headers=headers)
    finally:
        if own_client:
            await client.aclose()

    if resp.status_code == 401:
        raise PromptFetchUnauthorized(
            "ModelGuide rejected the agent API key (401). Confirm "
            "MODELGUIDE_API_KEY is the active key for this agent and the "
            "agent is marked active."
        )
    if resp.status_code == 404:
        # Spec: /me only 404s if the API key's owning agent was deleted
        # after the key was minted but before its `isActive` flag flipped.
        raise PromptFetchUnauthorized(
            "ModelGuide returned 404 for /api/agents/me — the agent this "
            "key belongs to no longer exists."
        )
    if resp.status_code >= 500:
        raise PromptFetchError(
            f"ModelGuide /api/agents/me returned {resp.status_code}: "
            f"{resp.text[:200]}"
        )
    if resp.status_code != 200:
        raise PromptFetchError(
            f"ModelGuide /api/agents/me returned unexpected status "
            f"{resp.status_code}: {resp.text[:200]}"
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise PromptFetchError(
            f"ModelGuide /api/agents/me returned non-JSON body: "
            f"{resp.text[:200]}"
        ) from exc

    if not isinstance(payload, dict):
        raise PromptFetchError(
            f"ModelGuide /api/agents/me returned {type(payload).__name__}, "
            "expected an object"
        )

    return _parse_agent_self(payload)


async def fetch_compiled_prompt(
    api_url: str,
    api_key: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> str:
    """Thin wrapper that returns just the compiled instructions string.

    Use this when the worker only cares about the prompt itself — most call
    sites in ``agent.py`` won't need the rest of the AgentSelf shape.
    """
    self_ = await fetch_agent_self(api_url, api_key, client=client)
    return self_.compiled_instructions
