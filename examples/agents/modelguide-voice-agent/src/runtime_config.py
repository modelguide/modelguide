"""Fetch the agent's runtime config (incl. compiled prompt) from ModelGuide.

The endpoint is ``GET /api/agents/me/runtime-config``; it authenticates via
the agent's API key (Bearer ``mgk_…``) and returns just enough for the
worker to spin up an LLM session with the latest compiled instructions.

See ADR-006 for why we fetch at job-start instead of stamping the prompt
into the worker image at deploy time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger("runtime_config")


class RuntimeConfigError(RuntimeError):
    """Raised when ModelGuide returns a non-2xx status."""


@dataclass(frozen=True)
class RuntimeConfig:
    id: str
    slug: str
    name: str
    modality: str
    model_family: str
    instructions: str | None
    compiled_at: str | None

    @property
    def has_compiled_prompt(self) -> bool:
        return bool(self.instructions and self.instructions.strip())


async def fetch_runtime_config(
    base_url: str,
    api_key: str,
    *,
    timeout: float = 5.0,
) -> RuntimeConfig:
    """GET /api/agents/me/runtime-config and parse the response."""
    url = base_url.rstrip("/") + "/api/agents/me/runtime-config"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise RuntimeConfigError(
                f"Network error fetching runtime config: {exc}"
            ) from exc

    if response.status_code != 200:
        raise RuntimeConfigError(
            f"Runtime config fetch failed: HTTP {response.status_code} {response.text[:200]}"
        )

    body = response.json()
    return RuntimeConfig(
        id=body["id"],
        slug=body["slug"],
        name=body["name"],
        modality=body["modality"],
        model_family=body["modelFamily"],
        instructions=body.get("instructions"),
        compiled_at=body.get("compiledAt"),
    )
