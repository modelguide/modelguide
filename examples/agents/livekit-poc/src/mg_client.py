"""Minimal ModelGuide REST client for the POC.

Posts the transcript on hangup. Skipped entirely when
``MODELGUIDE_API_URL`` / ``MODELGUIDE_API_KEY`` aren't set so the agent
can run against a local LiveKit server without a paired ModelGuide
instance. The production agent
(``examples/agents/livekit-agent/src/mg_client.py``) is the canonical
implementation if the POC ever needs more endpoints.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

import config

logger = logging.getLogger("mg_client")


def _enabled() -> bool:
    return bool(config.MODELGUIDE_API_URL and config.MODELGUIDE_API_KEY)


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
    }


async def post_messages(session_id: str, messages: list[dict[str, Any]]) -> None:
    """Best-effort: post transcript messages to the ModelGuide session.

    Failures are logged, never raised — the POC must not crash the
    LiveKit shutdown path if the API is down.
    """
    if not _enabled() or not session_id:
        return
    async with httpx.AsyncClient(
        base_url=config.MODELGUIDE_API_URL,
        headers=_headers(),
        timeout=10.0,
    ) as client:
        for msg in messages:
            try:
                resp = await client.post(
                    f"/api/sessions/{session_id}/messages", json=msg
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "post_messages %s -> %d: %s",
                        session_id,
                        resp.status_code,
                        resp.text[:200],
                    )
            except Exception:
                logger.exception("post_messages failed for %s", session_id)


async def complete_session(session_id: str, *, status: str = "completed") -> None:
    """Mark the ModelGuide session as completed (or abandoned)."""
    if not _enabled() or not session_id:
        return
    async with httpx.AsyncClient(
        base_url=config.MODELGUIDE_API_URL,
        headers=_headers(),
        timeout=10.0,
    ) as client:
        try:
            await client.patch(
                f"/api/sessions/{session_id}", json={"status": status}
            )
        except Exception:
            logger.exception("complete_session failed for %s", session_id)
