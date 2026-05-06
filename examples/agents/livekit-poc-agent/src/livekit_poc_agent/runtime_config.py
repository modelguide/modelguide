"""ModelGuide runtime-config client for the POC LiveKit agent.

On every session start, the worker calls
``GET /api/agents/me/runtime-config`` with its agent API key (mgk_*) to
pick up the latest compiled prompt. This is the single piece that makes
"compile in dashboard → talk to the new prompt" work without a worker
redeploy. Contract is locked by ``tests/test_runtime_config.py`` here
and ``tests/integration/agent-runtime-config.test.ts`` in the API.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class RuntimeConfig:
    """The narrow worker-facing slice of an agent.

    Mirrors ``AgentRuntimeConfig`` in ``modelguide-api/src/features/
    agents/agents.service.ts``. We deliberately do NOT carry secrets,
    integration URLs, or eval state — the worker has no business
    seeing them.
    """

    id: str
    name: str
    slug: str
    modality: str  # "voice" | "text"
    agent_platform: str  # "custom" | "elevenlabs" | "livekit"
    model_family: str  # "gpt" | "claude" | "gemini" | "generic"
    is_active: bool
    compiled_instructions: str | None
    compiled_at: str | None  # ISO 8601 string or None if never compiled
    prompt_config: dict[str, Any]
    metadata: dict[str, Any]


async def fetch(*, base_url: str, api_key: str, timeout: float = 10.0) -> RuntimeConfig:
    """Fetch the calling agent's runtime config from ModelGuide.

    Args:
        base_url: Base URL of the ModelGuide API (with or without trailing slash).
        api_key: Agent API key (mgk_xxx) — the agent identity is derived from it.
        timeout: HTTP timeout in seconds.

    Raises:
        httpx.HTTPStatusError: On 4xx/5xx — log and decide whether to fall
            back to a baked-in prompt at the call site.
    """
    base = base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    client = httpx.AsyncClient(base_url=base, headers=headers, timeout=timeout)
    try:
        resp = await client.get("/api/agents/me/runtime-config")
        resp.raise_for_status()
        data = resp.json()
    finally:
        await client.aclose()

    return RuntimeConfig(
        id=data["id"],
        name=data["name"],
        slug=data["slug"],
        modality=data["modality"],
        agent_platform=data["agentPlatform"],
        model_family=data["modelFamily"],
        is_active=data["isActive"],
        compiled_instructions=data.get("compiledInstructions"),
        compiled_at=data.get("compiledAt"),
        prompt_config=data.get("promptConfig") or {},
        metadata=data.get("metadata") or {},
    )


def resolve_instructions(config: RuntimeConfig, *, fallback: str) -> str:
    """Choose the prompt to actually feed the LLM.

    Prefers the freshly compiled prompt from the dashboard; falls back to
    the baked-in default when the agent has never been compiled (so the
    worker still completes the call instead of erroring out mid-greeting).
    Empty / whitespace-only strings are treated as 'not compiled'.
    """
    compiled = config.compiled_instructions
    if compiled and compiled.strip():
        return compiled
    return fallback
