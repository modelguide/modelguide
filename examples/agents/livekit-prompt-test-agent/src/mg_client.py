"""Minimal ModelGuide REST client used by the prompt-test agent.

Scope: session create/complete + post-call transcript submission. Tool
execution is intentionally not handled here — this prototype targets
the prompt-iteration loop, not full MCP-tool playback. Add an
``MCPConnection`` (see the buildpro example) if you want tool calls.
"""

import logging
from typing import Optional

import httpx

import config

logger = logging.getLogger("mg_client")


# A shared client gives us one TCP connection pool per worker process.
_http_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """Lazy-init a shared httpx.AsyncClient for REST calls."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
            },
            timeout=30.0,
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call during shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def create_session(user_identifier: Optional[str] = None) -> str:
    """Create a new ModelGuide session. Returns the session ID."""
    client = get_http_client()
    res = await client.post(
        "/api/sessions",
        json={
            "channelType": "voice",
            "userIdentifier": user_identifier or "voice-caller",
        },
    )
    res.raise_for_status()
    data = res.json()
    session_id = data["id"]
    logger.info("Session created: %s", session_id)
    return session_id


async def add_messages(session_id: str, messages: list[dict]) -> None:
    """Post messages to a session. Errors are logged, not raised — the
    voice call is already over by the time this runs."""
    client = get_http_client()
    for msg in messages:
        try:
            res = await client.post(
                f"/api/sessions/{session_id}/messages", json=msg
            )
            if not res.is_success:
                logger.warning(
                    "Failed to post message (status %s): %s",
                    res.status_code,
                    res.text,
                )
        except Exception:
            logger.exception("Error posting message to session %s", session_id)


async def complete_session(
    session_id: str,
    status: str = "completed",
    metadata: Optional[dict] = None,
) -> None:
    """Mark session as completed or abandoned."""
    client = get_http_client()
    body: dict = {"status": status}
    if metadata:
        body["metadata"] = metadata
    try:
        res = await client.patch(f"/api/sessions/{session_id}", json=body)
        if res.is_success:
            logger.info("Session %s completed", session_id)
        else:
            logger.warning(
                "Failed to complete session %s (status %s): %s",
                session_id,
                res.status_code,
                res.text,
            )
    except Exception:
        logger.exception("Error completing session %s", session_id)
