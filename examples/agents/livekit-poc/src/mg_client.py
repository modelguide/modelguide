"""Thin ModelGuide REST client — sessions + transcript posting.

The POC deliberately avoids MCP / tool wiring (see README) so this is a
much smaller surface than ``examples/agents/livekit-agent/src/mg_client.py``
— just session create / messages / complete. ``prompt_loader.py`` owns
the agent-fetch flow.
"""

from __future__ import annotations

import logging

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
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers=_headers(),
            timeout=30.0,
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def create_session(user_identifier: str | None = None) -> str:
    client = _get_http_client()
    response = await client.post(
        "/api/sessions",
        json={
            "channelType": "voice",
            "userIdentifier": user_identifier or config.USER_EMAIL,
        },
    )
    response.raise_for_status()
    session_id = response.json()["id"]
    logger.info("Session created: %s", session_id)
    return session_id


async def add_messages(session_id: str, messages: list[dict]) -> None:
    """Post the transcript. Errors are logged, not raised — losing the
    transcript should not abort the LiveKit shutdown path."""
    if not messages:
        return
    client = _get_http_client()
    for msg in messages:
        try:
            await client.post(
                f"/api/sessions/{session_id}/messages",
                json=msg,
            )
        except Exception:  # noqa: BLE001 — best-effort
            logger.exception("Failed to post message to session %s", session_id)


async def complete_session(session_id: str, *, status: str = "completed") -> None:
    client = _get_http_client()
    try:
        await client.patch(
            f"/api/sessions/{session_id}",
            json={"status": status},
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to complete session %s", session_id)
