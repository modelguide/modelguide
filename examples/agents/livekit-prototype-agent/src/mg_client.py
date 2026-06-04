"""Minimal ModelGuide REST client — just what the prototype needs.

The full BuildPro example agent (../livekit-agent/src/mg_client.py) adds an
MCP transport on top of REST. The prototype intentionally skips MCP — its
only job is to demonstrate the fetch-prompt-at-session-start pattern, so it
sticks to two REST endpoints:

  GET  /api/agents/me   — fetch the calling agent's runtime config
  POST /api/sessions    — create a session for the call
  PATCH /api/sessions/:id — mark the session completed/abandoned

If/when tools are added to the prototype, copy the MCP machinery from
``examples/agents/livekit-agent/src/mg_client.py``.
"""

from __future__ import annotations

import logging

import httpx

import config
from runtime_config import RuntimeConfig, parse_runtime_config

logger = logging.getLogger("mg_client")

_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    """Lazy shared httpx.AsyncClient — one TCP pool for the call's lifetime.

    Calls ``config.validate()`` on first use so the module-level URL/key
    constants are populated. Safe for tests that import mg_client without
    going through the agent entrypoint.
    """
    global _http
    if _http is None or _http.is_closed:
        config.validate()
        _http = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
            },
            timeout=15.0,
        )
    return _http


async def close_http_client() -> None:
    """Close the pooled client. Call during worker shutdown."""
    global _http
    if _http and not _http.is_closed:
        await _http.aclose()
        _http = None


async def fetch_runtime_config() -> RuntimeConfig:
    """Pull the calling agent's runtime config from ModelGuide.

    This is the click-Compile-then-Talk freshness path: each call hits a
    fresh row, so editing the prompt in the dashboard takes effect on the
    *next* dispatched call without redeploying the worker.
    """
    res = await _client().get("/api/agents/me")
    res.raise_for_status()
    cfg = parse_runtime_config(res.json())
    logger.info(
        "Fetched runtime config: slug=%s compiled=%s",
        cfg.slug,
        bool(cfg.compiled_instructions),
    )
    return cfg


async def create_session(user_identifier: str) -> str:
    """Create a ModelGuide session. Returns the session ID."""
    res = await _client().post(
        "/api/sessions",
        json={
            "channelType": "voice",
            "userIdentifier": user_identifier,
        },
    )
    res.raise_for_status()
    session_id: str = res.json()["id"]
    logger.info("Session created: %s", session_id)
    return session_id


async def complete_session(session_id: str, status: str = "completed") -> None:
    """Mark a session as completed/abandoned. Errors logged, never raised."""
    try:
        res = await _client().patch(
            f"/api/sessions/{session_id}",
            json={"status": status},
        )
        if not res.is_success:
            logger.warning(
                "Failed to complete session %s (%s): %s",
                session_id,
                res.status_code,
                res.text,
            )
    except Exception:
        logger.exception("Error completing session %s", session_id)
