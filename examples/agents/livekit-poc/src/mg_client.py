"""ModelGuide REST client for the POC agent.

The whole POC contract lives in one HTTP call: at session start the
worker GETs `/api/agents/me/runtime-config` with its `mgk_*` API key
and reads back the compiled prompt + prompt config. That payload is
the agent's source of truth — no local prompt files, no dispatch-time
metadata.

Failure mode policy: when the API is unreachable (network blip, DB
hiccup, expired key), `fetch_runtime_config()` returns `None` instead
of raising. The worker falls back to a generic default prompt so the
caller still hears a voice instead of dead air. We'd rather degrade
gracefully than crash mid-call.
"""

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
    """Close the shared HTTP client. Call during shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def fetch_runtime_config() -> dict | None:
    """Pull the latest runtime config for this agent from ModelGuide.

    Returns the parsed JSON payload (id, name, slug, modality, isActive,
    instructions, promptConfig, compiledAt) or ``None`` if the API is
    unreachable or returned a non-2xx response. Callers should treat
    ``None`` as "fall back to the default prompt and keep the session
    alive" — see `prompts.build_session_instructions`.
    """
    client = _get_http_client()
    try:
        res = await client.get("/api/agents/me/runtime-config")
    except Exception:
        logger.exception(
            "Runtime config fetch failed (network error) — falling back to defaults"
        )
        return None

    if not getattr(res, "is_success", res.status_code // 100 == 2):
        logger.warning(
            "Runtime config fetch returned %s: %s — falling back to defaults",
            res.status_code,
            getattr(res, "text", "<no body>"),
        )
        return None

    try:
        return res.json()
    except Exception:
        logger.exception(
            "Runtime config response wasn't JSON — falling back to defaults"
        )
        return None


# ---------------------------------------------------------------------------
# Session lifecycle (REST). Kept minimal — the POC is conversation-only,
# so we only need create + complete, not transcript posting.
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str | None = None) -> str | None:
    """Create a new ModelGuide session. Returns the session ID, or None on failure."""
    client = _get_http_client()
    try:
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
    except Exception:
        logger.exception("Failed to create session — continuing without tracking")
        return None


async def complete_session(session_id: str, status: str = "completed") -> None:
    """Mark session as completed or abandoned. Errors are logged, not raised."""
    client = _get_http_client()
    try:
        await client.patch(
            f"/api/sessions/{session_id}",
            json={"status": status},
        )
    except Exception:
        logger.exception("Error completing session %s", session_id)
