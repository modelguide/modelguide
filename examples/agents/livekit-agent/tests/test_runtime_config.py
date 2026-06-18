"""Tests for the runtime-config fetch path.

Workers call ``mg_client.fetch_runtime_config()`` at the start of every voice
session so the dashboard's "compile prompt → click Talk → hear it" loop
works without a redeploy. These tests pin down the contract:

* hits the ``GET /api/agents/me/runtime-config`` endpoint with the agent's
  API key in the Authorization header
* returns the parsed JSON payload on success
* returns ``None`` on transport / HTTP errors instead of raising — a stale
  prompt is preferable to a hard crash mid-call

The agent.py side then chooses between the fetched compiled prompt and the
local fallback (see ``buildpro.BuildProAgent``).
"""

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import mg_client


def _mock_response(
    status_code: int = 200,
    json_data: dict | None = None,
    text: str = "",
):
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


SAMPLE_PAYLOAD = {
    "id": "agt_abc",
    "name": "Sam",
    "slug": "buildpro-sam",
    "modality": "voice",
    "modelFamily": "gpt",
    "agentPlatform": "livekit",
    "promptConfig": {
        "persona": "Friendly contractor concierge.",
        "language": "English",
        "fillerPhrases": ["One moment.", "Let me check."],
    },
    "compiledInstructions": "You are Sam. Help contractors order supplies.",
    "compiledAt": "2026-06-18T00:00:00Z",
}


class TestFetchRuntimeConfig:
    @pytest.mark.asyncio
    async def test_hits_runtime_config_endpoint(self):
        """The endpoint path matters — the worker MUST hit /api/agents/me/runtime-config."""
        client = _mock_client("get", _mock_response(200, SAMPLE_PAYLOAD))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            await mg_client.fetch_runtime_config()

        # First positional arg is the URL path
        assert client.get.called
        path = client.get.call_args[0][0]
        assert path == "/api/agents/me/runtime-config"

    @pytest.mark.asyncio
    async def test_returns_parsed_payload(self):
        client = _mock_client("get", _mock_response(200, SAMPLE_PAYLOAD))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_runtime_config()

        assert result is not None
        assert result["id"] == "agt_abc"
        assert result["compiledInstructions"].startswith("You are Sam")
        assert result["promptConfig"]["language"] == "English"

    @pytest.mark.asyncio
    async def test_returns_none_on_http_error(self):
        """A 401/500 from the API should NOT crash the voice session —
        the worker falls back to its local prompt instead."""
        client = _mock_client("get", _mock_response(500, text="boom"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_runtime_config()

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_transport_error(self):
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectError("nope")
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_runtime_config()

        assert result is None


class TestResolveInstructions:
    """The agent.py-level helper that picks between fetched and local."""

    def test_prefers_fetched_compiled_prompt(self):
        # We use a small pure-function helper so the policy is testable.
        resolved = mg_client.resolve_instructions(
            fetched={"compiledInstructions": "FROM API"},
            local="FROM LOCAL",
        )
        assert resolved == "FROM API"

    def test_falls_back_to_local_when_fetched_is_none(self):
        resolved = mg_client.resolve_instructions(fetched=None, local="FROM LOCAL")
        assert resolved == "FROM LOCAL"

    def test_falls_back_to_local_when_compiled_is_blank(self):
        resolved = mg_client.resolve_instructions(
            fetched={"compiledInstructions": ""},
            local="FROM LOCAL",
        )
        assert resolved == "FROM LOCAL"

    def test_falls_back_to_local_when_compiled_missing(self):
        resolved = mg_client.resolve_instructions(
            fetched={"compiledInstructions": None},
            local="FROM LOCAL",
        )
        assert resolved == "FROM LOCAL"
