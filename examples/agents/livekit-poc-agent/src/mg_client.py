"""HTTP client for the ModelGuide API used by the POC agent.

Single responsibility: fetch the agent's identity + compiled prompt at
session start via ``GET /api/agents/me``. The endpoint is locked by ADR-015
and ``tests/unit/agents/agent-me-shape.test.ts`` on the API side; the
``AgentProfile`` dataclass here is the Python mirror of that contract.

No MCP, no session creation, no transcript posting — the production
``examples/agents/livekit-agent`` covers those. This client stays minimal
on purpose so the prompt-fetch path is easy to read and easy to swap.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger("mg_client")


@dataclass(frozen=True)
class AgentProfile:
    """The shape returned by ``GET /api/agents/me``.

    ``compiled_instructions`` is the system prompt the LLM will run with.
    When the dashboard operator hasn't compiled a prompt yet, this is
    ``None`` and the worker falls back to ``config.FALLBACK_INSTRUCTIONS``.
    """

    id: str
    name: str
    slug: str
    modality: str
    model_family: str
    agent_platform: str
    is_active: bool
    compiled_instructions: str | None
    compiled_at: str | None

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "AgentProfile":
        """Build from the raw JSON response. Tolerates missing optional fields."""
        return cls(
            id=data["id"],
            name=data["name"],
            slug=data["slug"],
            modality=data["modality"],
            model_family=data.get("modelFamily", "generic"),
            agent_platform=data.get("agentPlatform", "livekit"),
            is_active=data.get("isActive", False),
            compiled_instructions=data.get("compiledInstructions"),
            compiled_at=data.get("compiledAt"),
        )


class ModelGuideError(RuntimeError):
    """Raised when the ModelGuide API rejects or fails the request."""


async def fetch_agent_profile(
    api_url: str,
    api_key: str,
    *,
    timeout_seconds: float = 10.0,
    client: httpx.AsyncClient | None = None,
) -> AgentProfile:
    """Fetch the live agent profile (including compiled prompt).

    The ``client`` parameter is injection-only: production callers don't
    set it. Tests pass a respx-mocked client to avoid real HTTP.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    if client is None:
        async with httpx.AsyncClient(timeout=timeout_seconds) as owned:
            return await _get(owned, api_url, headers)
    return await _get(client, api_url, headers)


async def _get(
    client: httpx.AsyncClient, api_url: str, headers: dict[str, str],
) -> AgentProfile:
    url = f"{api_url.rstrip('/')}/api/agents/me"
    logger.info("fetching agent profile from %s", url)

    try:
        response = await client.get(url, headers=headers)
    except httpx.HTTPError as err:
        raise ModelGuideError(f"ModelGuide request failed: {err}") from err

    if response.status_code == 401:
        raise ModelGuideError(
            "ModelGuide rejected the API key (401). Check MODELGUIDE_API_KEY.",
        )
    if response.status_code >= 400:
        raise ModelGuideError(
            f"ModelGuide returned {response.status_code}: {response.text[:200]}",
        )

    try:
        payload = response.json()
    except ValueError as err:
        raise ModelGuideError(f"ModelGuide returned non-JSON: {err}") from err

    profile = AgentProfile.from_api(payload)
    logger.info(
        "fetched agent profile: slug=%s has_compiled_prompt=%s",
        profile.slug,
        profile.compiled_instructions is not None,
    )
    return profile


def resolve_instructions(profile: AgentProfile, fallback: str) -> str:
    """Pick the system prompt the LLM will run with.

    Prefers the live compiled prompt; falls back to ``fallback`` when the
    dashboard operator hasn't compiled one yet. Centralising the decision
    here means the entrypoint never has to ask "is this compiled or not?"
    and the choice is unit-testable in isolation.
    """
    compiled = profile.compiled_instructions
    if compiled and compiled.strip():
        return compiled
    return fallback
