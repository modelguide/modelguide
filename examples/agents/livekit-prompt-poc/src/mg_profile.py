"""Dynamic prompt loader for the LiveKit POC voice agent.

The worker boots without a hard-coded system prompt. On every job dispatch
it calls ``GET /api/agents/me`` with its own ModelGuide API key, reads
``compiledInstructions``, and uses that as the agent's system prompt.

This is the core difference from the production BuildPro agent (where the
prompt is baked at build time): the same worker image can serve any
prompt-config in any org without a redeploy, so the dashboard's
"Compile → Talk to agent" loop reflects the latest prompt instantly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

SELF_PROFILE_PATH = "/api/agents/me"


class ProfileFetchError(RuntimeError):
    """Raised when the self-profile endpoint returns a non-2xx response."""


@dataclass
class AgentProfile:
    """Subset of ``GET /api/agents/me`` the worker actually uses."""

    id: str
    name: str
    slug: str
    compiled_instructions: str | None
    compiled_at: str | None
    prompt_config: dict[str, Any] = field(default_factory=dict)
    modality: str = "voice"
    model_family: str = "generic"
    description: str | None = None
    agent_platform: str = "livekit"
    is_active: bool = True

    @property
    def has_compiled_prompt(self) -> bool:
        return bool(self.compiled_instructions)

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "AgentProfile":
        return cls(
            id=data["id"],
            name=data["name"],
            slug=data["slug"],
            description=data.get("description"),
            modality=data.get("modality", "voice"),
            model_family=data.get("modelFamily", "generic"),
            prompt_config=dict(data.get("promptConfig") or {}),
            agent_platform=data.get("agentPlatform", "livekit"),
            is_active=bool(data.get("isActive", True)),
            compiled_instructions=data.get("compiledInstructions"),
            compiled_at=data.get("compiledAt"),
        )


async def fetch_profile(client: httpx.AsyncClient) -> AgentProfile:
    """Pull the agent's own profile from ModelGuide.

    Uses the caller's ``httpx.AsyncClient`` (which must already carry the
    ``Authorization: Bearer mgk_xxx`` header) so the worker can share a
    single connection pool across the call lifetime.
    """
    response = await client.get(SELF_PROFILE_PATH)
    if response.status_code >= 400:
        snippet = response.text[:200]
        raise ProfileFetchError(
            f"GET {SELF_PROFILE_PATH} failed: {response.status_code} {snippet}"
        )
    return AgentProfile.from_api(response.json())


# Stub used when the dashboard hasn't compiled the agent yet. Keeps the
# worker functional so the operator can still verify the WebRTC path —
# but makes it loud which agent they're hearing.
_FALLBACK_PROMPT_TEMPLATE = (
    "You are a placeholder voice agent for ModelGuide agent {name} "
    "({slug}). No compiled prompt has been published yet. Politely tell "
    "the caller you are running with a fallback prompt and ask them to "
    "compile the agent's prompt in the dashboard, then try again."
)


def resolve_system_prompt(profile: AgentProfile) -> str:
    """Pick the system prompt for this job.

    Prefers the compiled instructions; falls back to a clearly-labelled
    placeholder so the operator can tell the difference at runtime
    without having to inspect logs.
    """
    if profile.compiled_instructions:
        return profile.compiled_instructions
    return _FALLBACK_PROMPT_TEMPLATE.format(name=profile.name, slug=profile.slug)
