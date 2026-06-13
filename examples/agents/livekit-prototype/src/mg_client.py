"""Slim ModelGuide REST client for the LiveKit prototype.

Two responsibilities:
1. Pull the latest compiled prompt at session start (``fetch_runtime_config``)
2. Create + complete a ModelGuide session around the call

Tools are routed through MCP separately — see ``tools.py``.

Keep this file boring. The BuildPro agent has the multi-feature client; this
one stays narrow on purpose so the prototype is easy to read end-to-end.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

import config

logger = logging.getLogger("mg_client")


@dataclass
class RuntimeConfig:
    """Agent identity + compiled prompt, served by ``GET /api/agents/me/runtime-config``.

    Snake-case mirrors the Python convention; ``fetch_runtime_config`` maps
    the camelCase API payload into this struct.
    """

    agent_id: str
    slug: str
    name: str
    modality: str
    model_family: str
    compiled_instructions: str | None
    compiled_at: str | None

    def resolve_instructions(self) -> str:
        """Return the prompt to feed to the LLM.

        Falls back to ``config.FALLBACK_PROMPT`` when the operator hasn't
        compiled the agent yet — never returns an empty string, since an
        empty system prompt makes the LLM produce confused, unmoored output.
        """
        if self.compiled_instructions and self.compiled_instructions.strip():
            return self.compiled_instructions
        return config.FALLBACK_PROMPT


# ---------------------------------------------------------------------------
# Shared HTTP client
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
    }


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers=_headers(),
            timeout=15.0,
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ---------------------------------------------------------------------------
# Runtime config (the "sync" part of "sync & test")
# ---------------------------------------------------------------------------


async def fetch_runtime_config() -> RuntimeConfig:
    """Pull the latest compiled prompt for the API key in use.

    Raises ``httpx.HTTPStatusError`` on non-2xx — the worker should crash
    loud here rather than silently fall back, since 401/403 means the agent
    is deactivated or the key was rotated, and 5xx means the API is down.
    """
    client = _get_http_client()
    res = await client.get("/api/agents/me/runtime-config")
    res.raise_for_status()
    data = res.json()
    return RuntimeConfig(
        agent_id=data["agentId"],
        slug=data["slug"],
        name=data["name"],
        modality=data["modality"],
        model_family=data["modelFamily"],
        compiled_instructions=data.get("compiledInstructions"),
        compiled_at=data.get("compiledAt"),
    )


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str = "voice-caller") -> str:
    """Create a ModelGuide session. Returns the session ID (uuid)."""
    client = _get_http_client()
    res = await client.post(
        "/api/sessions",
        json={"channelType": "voice", "userIdentifier": user_identifier},
    )
    res.raise_for_status()
    return res.json()["id"]


async def complete_session(session_id: str, status: str = "completed") -> None:
    """Mark the session completed or abandoned. Errors are logged, not raised.

    Called from the disconnect path, where raising would mask the user-visible
    "the call ended" event behind a noisy stack trace.
    """
    client = _get_http_client()
    try:
        res = await client.patch(
            f"/api/sessions/{session_id}", json={"status": status}
        )
        if not res.is_success:
            logger.warning(
                "complete_session %s failed (status %s): %s",
                session_id,
                res.status_code,
                res.text,
            )
    except Exception:
        logger.exception("complete_session %s raised", session_id)
