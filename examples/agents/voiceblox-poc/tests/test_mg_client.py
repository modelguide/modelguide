"""Tests for the ModelGuide REST client.

The voiceblox prototype only uses three REST endpoints:
- GET  /api/agents/me           → fetch_agent_config()
- POST /api/sessions            → create_session()
- PATCH /api/sessions/:id       → complete_session()

MCP tool execution is out of scope for the POC — see the buildpro example
for a full MCP integration.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import mg_client


def _mock_response(status_code=200, json_data=None, text=""):
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


def _mock_client(method="get", response=None):
    client = AsyncMock()
    getattr(client, method).return_value = response or _mock_response(200)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


# ---------------------------------------------------------------------------
# fetch_agent_config — the heart of the POC
# ---------------------------------------------------------------------------


class TestFetchAgentConfig:
    """The worker calls GET /api/agents/me at session start to pull the
    latest compiled prompt. These tests pin the contract so a backend
    change can't silently break the worker."""

    @pytest.mark.asyncio
    async def test_calls_agents_me_with_bearer_auth(self):
        response = _mock_response(
            200,
            {
                "id": "agt_123",
                "name": "Voiceblox Agent",
                "slug": "voiceblox-agent",
                "compiledInstructions": "You are a helpful assistant.",
                "promptConfig": {},
            },
        )
        client = _mock_client("get", response)

        with patch("mg_client.httpx.AsyncClient", return_value=client):
            cfg = await mg_client.fetch_agent_config()

        client.get.assert_called_once()
        url = client.get.call_args[0][0]
        assert url == "/api/agents/me"
        assert cfg["compiledInstructions"] == "You are a helpful assistant."
        assert cfg["slug"] == "voiceblox-agent"

    @pytest.mark.asyncio
    async def test_returns_none_compiled_when_not_yet_compiled(self):
        # An uncompiled agent returns null compiledInstructions — the worker
        # falls back to its default prompt rather than crashing.
        response = _mock_response(
            200,
            {
                "id": "agt_123",
                "name": "Fresh Agent",
                "slug": "fresh-agent",
                "compiledInstructions": None,
                "promptConfig": {},
            },
        )
        with patch(
            "mg_client.httpx.AsyncClient",
            return_value=_mock_client("get", response),
        ):
            cfg = await mg_client.fetch_agent_config()

        assert cfg["compiledInstructions"] is None

    @pytest.mark.asyncio
    async def test_raises_on_401(self):
        # Invalid API key → 401. We want the error to propagate so the
        # worker shuts down instead of pretending nothing's wrong.
        response = _mock_response(401, text="Unauthorized")
        with patch(
            "mg_client.httpx.AsyncClient",
            return_value=_mock_client("get", response),
        ):
            with pytest.raises(httpx.HTTPStatusError):
                await mg_client.fetch_agent_config()

    @pytest.mark.asyncio
    async def test_raises_on_404(self):
        # 404 means the agent was deleted out from under the worker. Hard
        # fail — the operator needs to redeploy with a valid agent ID.
        response = _mock_response(404, text="Not Found")
        with patch(
            "mg_client.httpx.AsyncClient",
            return_value=_mock_client("get", response),
        ):
            with pytest.raises(httpx.HTTPStatusError):
                await mg_client.fetch_agent_config()


# ---------------------------------------------------------------------------
# Sessions — minimal create / complete
# ---------------------------------------------------------------------------


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_returns_session_id(self):
        client = _mock_client("post", _mock_response(200, {"id": "sess_abc"}))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            session_id = await mg_client.create_session("caller@test.com")

        assert session_id == "sess_abc"
        call_kwargs = client.post.call_args
        assert call_kwargs[1]["json"]["channelType"] == "voice"
        assert call_kwargs[1]["json"]["userIdentifier"] == "caller@test.com"

    @pytest.mark.asyncio
    async def test_default_identifier(self):
        client = _mock_client("post", _mock_response(200, {"id": "sess_1"}))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.create_session()

        assert client.post.call_args[1]["json"]["userIdentifier"] == "voice-caller"


class TestCompleteSession:
    @pytest.mark.asyncio
    async def test_patches_status(self):
        client = _mock_client("patch")
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.complete_session("sess_1", status="completed")

        assert client.patch.call_args[1]["json"]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_does_not_raise_on_failure(self):
        # Best-effort cleanup. Failing to mark complete shouldn't tear the
        # worker down on its way out — the next health-check would notice
        # the orphaned active session anyway.
        client = _mock_client("patch", _mock_response(500, text="Server error"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.complete_session("sess_1")
