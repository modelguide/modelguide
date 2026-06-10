"""ModelGuide REST client for the voiceblox prototype.

Only three calls:

* ``fetch_runtime`` — pulls the agent's compiled prompt + identity right
  before greeting the caller. This is the core of the "compile in dashboard
  → speak with new prompt on next call" loop.
* ``create_session`` — records the conversation in the dashboard so
  transcript / feedback / analytics all join on the session id.
* ``add_messages`` + ``complete_session`` — post the final transcript and
  flip the session status when the call ends.

Tool execution via MCP is intentionally NOT here — the prototype's value is
the prompt loop, and dragging the MCP stack in muddies that story. Tools
remain the production agent's job (``examples/agents/livekit-agent``).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

import config

logger = logging.getLogger("voiceblox.mg_client")


@dataclass(frozen=True)
class RuntimePayload:
    """Mirror of ``AgentRuntimePayload`` from the API.

    Keeping this as a small dataclass (not a dict) catches typos and makes the
    contract grep-able. If the API adds fields, update both sides — the lock
    is the unit test in ``tests/test_mg_client.py``.
    """

    id: str
    name: str
    slug: str
    modality: str
    model_family: str
    agent_platform: str
    is_active: bool
    compiled_instructions: str | None
    compiled_at: str | None
    prompt_config: dict[str, Any]

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RuntimePayload":
        return cls(
            id=data["id"],
            name=data["name"],
            slug=data["slug"],
            modality=data["modality"],
            model_family=data["modelFamily"],
            agent_platform=data["agentPlatform"],
            is_active=data["isActive"],
            compiled_instructions=data.get("compiledInstructions"),
            compiled_at=data.get("compiledAt"),
            prompt_config=data.get("promptConfig") or {},
        )


_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    """Lazy-init a shared httpx.AsyncClient for the agent's lifetime."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers={
                "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call during shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def fetch_runtime() -> RuntimePayload:
    """Fetch the agent's identity + latest compiled prompt.

    Raises ``httpx.HTTPStatusError`` on 4xx/5xx — the entrypoint decides
    whether to fall back to ``config.FALLBACK_PROMPT`` or refuse to start.
    """
    res = await _client().get("/api/agents/me/runtime")
    res.raise_for_status()
    payload = RuntimePayload.from_json(res.json())
    logger.info(
        "Fetched runtime for agent %s (slug=%s, compiled=%s)",
        payload.id,
        payload.slug,
        payload.compiled_at or "never",
    )
    return payload


async def create_session(user_identifier: str | None = None) -> str:
    """Create a new ModelGuide session. Returns the session ID."""
    res = await _client().post(
        "/api/sessions",
        json={
            "channelType": "voice",
            "userIdentifier": user_identifier or "voice-caller",
        },
    )
    res.raise_for_status()
    session_id = res.json()["id"]
    logger.info("Created session %s", session_id)
    return session_id


async def add_messages(session_id: str, messages: list[dict[str, Any]]) -> None:
    """Post messages to a session. Errors are logged, not raised — we never
    want a flaky API call to kill an otherwise-successful call."""
    client = _client()
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
    session_id: str, status: str = "completed"
) -> None:
    """Mark a session as completed or abandoned. Logged, not raised."""
    try:
        res = await _client().patch(
            f"/api/sessions/{session_id}", json={"status": status}
        )
        if res.is_success:
            logger.info("Completed session %s (%s)", session_id, status)
        else:
            logger.warning(
                "Failed to complete session %s (status %s): %s",
                session_id,
                res.status_code,
                res.text,
            )
    except Exception:
        logger.exception("Error completing session %s", session_id)
