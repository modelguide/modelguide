"""Thin ModelGuide REST client — session lifecycle only.

This POC deliberately skips the MCP tool wiring that the full BuildPro Sam
agent has (see ``examples/agents/livekit-agent/src/mg_client.py``). The
goal here is the smallest possible "talk to the latest prompt" loop.
Tool execution can be layered in later by reusing the full client.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("mg_session")


def _client(base_url: str, api_key: str, timeout: float = 30.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )


async def create_session(
    *, base_url: str, api_key: str, user_identifier: str
) -> str | None:
    """Create a ModelGuide session for this call. Returns session id or None on failure.

    Failures are logged but never raised — the call should still complete
    even if session tracking is broken.
    """
    async with _client(base_url, api_key) as c:
        try:
            resp = await c.post(
                "/api/sessions",
                json={"channelType": "voice", "userIdentifier": user_identifier},
            )
            resp.raise_for_status()
            return resp.json()["id"]
        except Exception:
            logger.exception("create_session failed")
            return None


async def complete_session(
    *, base_url: str, api_key: str, session_id: str, status: str = "completed"
) -> None:
    """Mark the session as completed/abandoned. Errors are logged, not raised."""
    async with _client(base_url, api_key) as c:
        try:
            resp = await c.patch(
                f"/api/sessions/{session_id}",
                json={"status": status},
            )
            if not resp.is_success:
                logger.warning(
                    "complete_session %s returned %s: %s",
                    session_id,
                    resp.status_code,
                    resp.text,
                )
        except Exception:
            logger.exception("complete_session failed for %s", session_id)
