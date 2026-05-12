"""Fetch the latest agent runtime configuration from ModelGuide.

The prototype LiveKit worker calls :func:`fetch_runtime_config` at the start
of every session — that's how a dashboard "compile prompt → talk to agent"
loop picks up changes without a worker redeploy.

The contract with the API (``GET /api/agents/runtime-config``) is locked in
by ``tests/test_runtime_config.py`` and by the integration test on the API
side (``modelguide-api/tests/integration/agents-runtime-config.test.ts``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger("runtime_config")

RUNTIME_CONFIG_PATH = "/api/agents/runtime-config"


class RuntimeConfigError(RuntimeError):
    """Raised when the worker cannot determine which prompt to run with.

    Deliberately distinct from ``httpx`` exceptions so the entrypoint can
    log a clear "your agent isn't reachable / authenticated" message instead
    of a generic transport error.
    """


@dataclass(frozen=True)
class RuntimeConfig:
    id: str
    slug: str
    name: str
    modality: str  # "voice" | "text"
    model_family: str  # "gpt" | "claude" | "gemini" | "generic"
    agent_platform: str  # "custom" | "elevenlabs" | "livekit"
    compiled_instructions: Optional[str]
    compiled_at: Optional[str]
    prompt_config: dict[str, Any]


# ---------------------------------------------------------------------------
# Shared HTTP client
# ---------------------------------------------------------------------------

_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10.0)
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_runtime_config(
    *,
    api_url: str,
    api_key: str,
    client: Optional[httpx.AsyncClient] = None,
) -> RuntimeConfig:
    """Fetch the authenticated agent's latest runtime config.

    Args:
        api_url: ModelGuide API base URL (with or without trailing slash).
        api_key: Agent-scoped API key (``mgk_xxx``). Sent as ``Bearer``.
        client: Optional pre-built ``httpx.AsyncClient`` (used by tests to
            inject a mock transport). The module-level shared client is used
            when not provided.

    Returns:
        A :class:`RuntimeConfig` with the latest compiled prompt and metadata.

    Raises:
        RuntimeConfigError: on any non-2xx status or transport failure.
    """
    base = api_url.rstrip("/")
    url = f"{base}{RUNTIME_CONFIG_PATH}"

    owns_client = client is None
    c = client or _get_http_client()

    try:
        resp = await c.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
    except httpx.HTTPError as e:
        raise RuntimeConfigError(
            f"transport error fetching runtime config from {url}: {e}"
        ) from e
    finally:
        if owns_client and client is None:
            # Caller didn't pass a client AND we created one via shared
            # singleton — don't close it; the next call will reuse it.
            pass

    if resp.status_code >= 400:
        raise RuntimeConfigError(
            f"runtime config fetch failed: {resp.status_code} {resp.text[:200]}"
        )

    data = resp.json()
    return RuntimeConfig(
        id=data["id"],
        slug=data["slug"],
        name=data["name"],
        modality=data["modality"],
        model_family=data["modelFamily"],
        agent_platform=data["agentPlatform"],
        compiled_instructions=data.get("compiledInstructions"),
        compiled_at=data.get("compiledAt"),
        prompt_config=data.get("promptConfig") or {},
    )


def build_system_instructions(
    config: RuntimeConfig,
    *,
    fallback: str,
) -> str:
    """Pick the system prompt the LLM should run with.

    Prefers the compiled prompt; falls back to the operator-supplied
    ``FALLBACK_PROMPT`` when the agent has never been compiled. Raises if
    both are empty — running with no instructions at all is rarely what
    the operator intended and produces wildly off-script behaviour.
    """
    if config.compiled_instructions:
        return config.compiled_instructions

    if fallback and fallback.strip():
        logger.warning(
            "agent %s has no compiled prompt — using fallback (%d chars)",
            config.slug,
            len(fallback),
        )
        return fallback

    raise RuntimeConfigError(
        f"agent {config.slug} has no compiled prompt and no FALLBACK_PROMPT — refusing to start"
    )
