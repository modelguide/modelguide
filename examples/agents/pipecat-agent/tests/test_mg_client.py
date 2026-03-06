"""Tests for the ModelGuide REST client (session management).

MCP tool execution (call_tool) is not tested here since it requires
a real MCP server connection. Those paths are covered by the tools tests
which mock mg_client.call_tool.
"""

import pytest
import httpx
from unittest.mock import patch, AsyncMock, MagicMock

import mg_client


def _mock_response(status_code: int = 200, json_data: dict | None = None, text: str = ""):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    resp.json.return_value = json_data or {}
    resp.text = text
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp
        )
    return resp


def _mock_client(method="post", response=None):
    """Create an AsyncMock httpx client with the given method returning response."""
    client = AsyncMock()
    getattr(client, method).return_value = response or _mock_response(200)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_returns_session_id(self):
        client = _mock_client("post", _mock_response(200, {"id": "sess_new_123"}))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            session_id = await mg_client.create_session("caller@test.com")

        assert session_id == "sess_new_123"
        call_kwargs = client.post.call_args
        assert call_kwargs[1]["json"]["channelType"] == "voice"
        assert call_kwargs[1]["json"]["userIdentifier"] == "caller@test.com"

    @pytest.mark.asyncio
    async def test_default_identifier(self):
        client = _mock_client("post", _mock_response(200, {"id": "sess_456"}))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.create_session()

        call_kwargs = client.post.call_args
        assert call_kwargs[1]["json"]["userIdentifier"] == "voice-caller"

    @pytest.mark.asyncio
    async def test_raises_on_error(self):
        client = _mock_client("post", _mock_response(500, text="Internal Server Error"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            with pytest.raises(httpx.HTTPStatusError):
                await mg_client.create_session()


class TestAddMessages:
    @pytest.mark.asyncio
    async def test_posts_each_message(self):
        client = _mock_client("post")
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.add_messages("sess_1", messages)

        assert client.post.call_count == 2

    @pytest.mark.asyncio
    async def test_does_not_raise_on_failure(self):
        client = _mock_client("post", _mock_response(422, text="Validation error"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.add_messages("sess_1", [{"role": "user", "content": "hi"}])


class TestCompleteSession:
    @pytest.mark.asyncio
    async def test_patches_status(self):
        client = _mock_client("patch")
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.complete_session("sess_1")

        call_kwargs = client.patch.call_args
        assert call_kwargs[1]["json"]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_includes_metadata(self):
        client = _mock_client("patch")
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.complete_session("sess_1", metadata={"duration_s": 120})

        call_kwargs = client.patch.call_args
        assert call_kwargs[1]["json"]["metadata"] == {"duration_s": 120}

    @pytest.mark.asyncio
    async def test_does_not_raise_on_failure(self):
        client = _mock_client("patch", _mock_response(500, text="Server error"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.complete_session("sess_1")
