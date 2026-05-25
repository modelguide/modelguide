"""ModelGuide REST client for the POC agent.

Two responsibilities:
  1. ``fetch_runtime_config`` — pull the agent's latest compiled prompt and
     metadata via ``GET /api/agents/me/runtime-config`` on every session boot.
     This is the "sync from the dashboard without redeploy" hook.
  2. ``create_session`` / ``complete_session`` — minimal session lifecycle
     so transcripts and feedback can attribute the call.

A shared httpx.AsyncClient lives for the agent process so we get connection
reuse across sessions.  Tests inject a stub client via ``set_http_client``
to avoid network in CI.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

import config

logger = logging.getLogger("mg_client")


@dataclass(frozen=True)
class RuntimeConfig:
    """Mirror of the ``AgentRuntimeConfig`` TypeScript shape (see
    ``modelguide-api/src/features/agents/runtime-config.ts``).  Kept as a
    dataclass so tests can construct one directly without round-tripping
    through HTTP."""

    id: str
    name: str
    slug: str
    modality: str
    compiled_instructions: str | None
    compiled_at: str | None
    prompt_config: dict[str, Any]

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> "RuntimeConfig":
        return cls(
            id=payload["id"],
            name=payload["name"],
            slug=payload["slug"],
            modality=payload["modality"],
            compiled_instructions=payload.get("compiledInstructions"),
            compiled_at=payload.get("compiledAt"),
            prompt_config=payload.get("promptConfig") or {},
        )

    def resolved_instructions(self) -> str:
        """Compiled prompt, or the fallback if the operator hasn't compiled.

        Keeping the fallback here (rather than in agent.py) means tests can
        assert the "no compiled prompt yet" UX without booting a session.
        """
        if self.compiled_instructions and self.compiled_instructions.strip():
            return self.compiled_instructions
        return config.FALLBACK_INSTRUCTIONS


# ---------------------------------------------------------------------------
# HTTP client lifecycle
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
        "Content-Type": "application/json",
    }


def get_http_client() -> httpx.AsyncClient:
    """Lazy-init the shared client.  Pure-function on first call; reused
    across sessions in the worker.

    No ``base_url`` — callers pass absolute URLs.  Reason: httpx >=0.28
    broke cookie extraction with a base_url + relative path combination
    in some adapter paths (the urllib cookie compat layer chokes on
    schemeless URLs).  Using absolute URLs everywhere sidesteps it and
    is also clearer in logs.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            headers=_headers(),
            timeout=15.0,
        )
    return _http_client


def _url(path: str) -> str:
    return f"{config.MODELGUIDE_API_URL}{path}"


def set_http_client(client: httpx.AsyncClient | None) -> None:
    """Tests inject a fake/closed client here."""
    global _http_client
    _http_client = client


async def close_http_client() -> None:
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


# ---------------------------------------------------------------------------
# Runtime config (the "sync from dashboard" call)
# ---------------------------------------------------------------------------


async def fetch_runtime_config() -> RuntimeConfig:
    """Fetch the calling agent's runtime config.

    The agent is identified by its API key (sent in the Authorization
    header); there's no path param to spoof.  Errors propagate so the
    entrypoint can decide whether to bail or fall back — we don't want a
    silent default that masks a misconfigured deploy.
    """
    client = get_http_client()
    res = await client.get(_url("/api/agents/me/runtime-config"))
    res.raise_for_status()
    payload = res.json()
    cfg = RuntimeConfig.from_api(payload)
    logger.info(
        "Runtime config: agent=%s slug=%s compiled_at=%s has_prompt=%s",
        cfg.id,
        cfg.slug,
        cfg.compiled_at,
        bool(cfg.compiled_instructions),
    )
    return cfg


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str | None = None) -> str | None:
    """Create a ModelGuide session.  Returns the id, or None on failure
    (so a session API hiccup doesn't take down the voice call)."""
    try:
        client = get_http_client()
        res = await client.post(
            _url("/api/sessions"),
            json={
                "channelType": "voice",
                "userIdentifier": user_identifier or "poc-caller",
            },
        )
        res.raise_for_status()
        return res.json()["id"]
    except Exception:
        logger.exception("Failed to create ModelGuide session — running untracked")
        return None


async def complete_session(session_id: str, status: str = "completed") -> None:
    try:
        client = get_http_client()
        await client.patch(
            _url(f"/api/sessions/{session_id}"),
            json={"status": status},
        )
    except Exception:
        logger.exception("Failed to complete session %s", session_id)
