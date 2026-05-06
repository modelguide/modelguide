"""Tests for the thin ModelGuide session client.

Session creation/completion failures must NEVER raise out of these helpers
— a logging hiccup at session-end shouldn't be the reason a real call
ends in a stack trace. These tests pin that 'always swallow' contract.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from livekit_poc_agent import mg_session


def _resp(status: int, json_data: dict | None = None, text: str = ""):
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.is_success = 200 <= status < 300
    r.json.return_value = json_data or {}
    r.text = text
    if status >= 400:
        r.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("err", request=MagicMock(), response=r)
        )
    else:
        r.raise_for_status = MagicMock()
    return r


def _client(method: str, response):
    c = AsyncMock()
    getattr(c, method).return_value = response
    c.__aenter__ = AsyncMock(return_value=c)
    c.__aexit__ = AsyncMock(return_value=False)
    return c


@pytest.mark.asyncio
async def test_create_session_returns_id_on_success():
    c = _client("post", _resp(200, {"id": "sess_123"}))
    with patch("livekit_poc_agent.mg_session.httpx.AsyncClient", return_value=c):
        sid = await mg_session.create_session(
            base_url="http://x", api_key="mgk_x", user_identifier="caller@x.com"
        )
    assert sid == "sess_123"
    body = c.post.call_args[1]["json"]
    assert body == {"channelType": "voice", "userIdentifier": "caller@x.com"}


@pytest.mark.asyncio
async def test_create_session_returns_none_on_http_error():
    """Don't crash the call just because session tracking is degraded."""
    c = _client("post", _resp(500, text="boom"))
    with patch("livekit_poc_agent.mg_session.httpx.AsyncClient", return_value=c):
        sid = await mg_session.create_session(
            base_url="http://x", api_key="mgk_x", user_identifier="caller@x.com"
        )
    assert sid is None


@pytest.mark.asyncio
async def test_complete_session_swallows_errors():
    """Same: session completion failures must not propagate."""
    c = _client("patch", _resp(500, text="server gone"))
    with patch("livekit_poc_agent.mg_session.httpx.AsyncClient", return_value=c):
        # Must not raise.
        await mg_session.complete_session(
            base_url="http://x", api_key="mgk_x", session_id="sess_x"
        )


@pytest.mark.asyncio
async def test_complete_session_sends_status():
    c = _client("patch", _resp(200, {"id": "sess_x", "status": "completed"}))
    with patch("livekit_poc_agent.mg_session.httpx.AsyncClient", return_value=c):
        await mg_session.complete_session(
            base_url="http://x",
            api_key="mgk_x",
            session_id="sess_x",
            status="abandoned",
        )
    body = c.patch.call_args[1]["json"]
    assert body == {"status": "abandoned"}
