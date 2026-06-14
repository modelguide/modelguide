"""ModelGuide REST client for the voiceblox prototype.

The worker only needs three endpoints:

- GET  /api/agents/me          → fetch_agent_config()
- POST /api/sessions           → create_session()
- PATCH /api/sessions/:id      → complete_session()

A shared `httpx.AsyncClient` keeps a single TCP pool alive for the
lifetime of the worker. `close_http_client()` is called on shutdown.

Note: this client doesn't do MCP tool execution. The POC is
prompt-driven and intentionally has zero connector tools — see the
buildpro example for an MCP-integrated agent.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

import config

logger = logging.getLogger("mg_client")


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
    }


_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    """Lazy-init a shared httpx.AsyncClient for REST calls."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers=_headers(),
            timeout=10.0,
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ---------------------------------------------------------------------------
# Self-discovery — the heart of the POC
# ---------------------------------------------------------------------------


async def fetch_agent_config() -> dict[str, Any]:
    """Fetch the runtime config for the agent identified by our API key.

    Returns the JSON body as a dict. Raises httpx.HTTPStatusError on 4xx/5xx —
    callers decide whether to fall back to a default prompt (transient errors)
    or hard-fail (auth / not-found, which usually mean a misdeploy).
    """
    client = _get_http_client()
    res = await client.get("/api/agents/me")
    res.raise_for_status()
    return res.json()


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str | None = None) -> str:
    """Create a new session row and return its UUID."""
    client = _get_http_client()
    res = await client.post(
        "/api/sessions",
        json={
            "channelType": "voice",
            "userIdentifier": user_identifier or "voice-caller",
        },
    )
    res.raise_for_status()
    session_id = res.json()["id"]
    logger.info("Session created: %s", session_id)
    return session_id


async def complete_session(
    session_id: str,
    status: str = "completed",
    metadata: dict | None = None,
) -> None:
    """Mark a session as completed/abandoned. Best-effort: errors are logged."""
    client = _get_http_client()
    body: dict[str, Any] = {"status": status}
    if metadata:
        body["metadata"] = metadata
    try:
        res = await client.patch(f"/api/sessions/{session_id}", json=body)
        if res.is_success:
            logger.info("Session %s marked %s", session_id, status)
        else:
            logger.warning(
                "complete_session %s failed (status=%s): %s",
                session_id,
                res.status_code,
                res.text,
            )
    except Exception:
        logger.exception("complete_session %s raised", session_id)
