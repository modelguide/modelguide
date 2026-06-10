"""Unit tests for the ModelGuide REST client.

The shape of ``RuntimePayload.from_json`` IS the contract between the agent
runtime and the API's ``GET /api/agents/me/runtime`` endpoint. If a field
name drifts on either side, every call to this prototype agent fetches an
unparseable payload and falls back to the canned "not configured" prompt.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import mg_client


def _mock_response(status_code: int = 200, json_data: dict | None = None):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    resp.json.return_value = json_data or {}
    resp.text = ""
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp
        )
    return resp


def _client_mock(method: str, response):
    """Patch ``mg_client._client()`` to return a stub AsyncClient."""
    client = MagicMock()
    setattr(client, method, AsyncMock(return_value=response))
    client.is_closed = False
    return client


class TestRuntimePayload:
    def test_round_trips_full_payload(self):
        """All the fields the entrypoint reads must come through unchanged.

        Mirrors the response shape locked in by
        ``tests/integration/agent-runtime.test.ts``.
        """
        payload = mg_client.RuntimePayload.from_json(
            {
                "id": "agt_1",
                "name": "GlowBox Voice",
                "slug": "glowbox-voice",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "isActive": True,
                "compiledInstructions": "You are Sam.",
                "compiledAt": "2026-01-01T00:00:00Z",
                "promptConfig": {"persona": "Friendly"},
            }
        )
        assert payload.id == "agt_1"
        assert payload.slug == "glowbox-voice"
        assert payload.modality == "voice"
        assert payload.model_family == "gpt"
        assert payload.agent_platform == "livekit"
        assert payload.is_active is True
        assert payload.compiled_instructions == "You are Sam."
        assert payload.compiled_at == "2026-01-01T00:00:00Z"
        assert payload.prompt_config == {"persona": "Friendly"}

    def test_handles_uncompiled_agent(self):
        """An agent the operator hasn't compiled returns nulls — the agent
        runtime decides to fall back to ``config.FALLBACK_PROMPT``."""
        payload = mg_client.RuntimePayload.from_json(
            {
                "id": "agt_1",
                "name": "x",
                "slug": "x",
                "modality": "voice",
                "modelFamily": "generic",
                "agentPlatform": "livekit",
                "isActive": False,
                "compiledInstructions": None,
                "compiledAt": None,
                "promptConfig": {},
            }
        )
        assert payload.compiled_instructions is None
        assert payload.compiled_at is None
        assert payload.prompt_config == {}

    def test_treats_missing_prompt_config_as_empty_dict(self):
        """``prompt_config`` is consumed with ``.get()`` calls — if the API
        ever omits the field entirely we still want a dict, not None, so
        downstream code stays untouched."""
        payload = mg_client.RuntimePayload.from_json(
            {
                "id": "x",
                "name": "x",
                "slug": "x",
                "modality": "voice",
                "modelFamily": "generic",
                "agentPlatform": "livekit",
                "isActive": True,
            }
        )
        assert payload.prompt_config == {}
        assert payload.compiled_instructions is None


class TestFetchRuntime:
    @pytest.mark.asyncio
    async def test_returns_parsed_payload(self):
        client = _client_mock(
            "get",
            _mock_response(
                200,
                {
                    "id": "agt_1",
                    "name": "Sam",
                    "slug": "sam",
                    "modality": "voice",
                    "modelFamily": "gpt",
                    "agentPlatform": "livekit",
                    "isActive": True,
                    "compiledInstructions": "Hi",
                    "compiledAt": "2026-01-01T00:00:00Z",
                    "promptConfig": {},
                },
            ),
        )
        with patch("mg_client._client", return_value=client):
            payload = await mg_client.fetch_runtime()
        assert payload.id == "agt_1"
        assert payload.compiled_instructions == "Hi"
        # Endpoint path is part of the contract — must not silently rename.
        assert client.get.call_args[0][0] == "/api/agents/me/runtime"

    @pytest.mark.asyncio
    async def test_raises_on_http_error(self):
        """Auth failures, agent deactivation, etc. should propagate so the
        entrypoint can log and fall back to the canned prompt."""
        client = _client_mock("get", _mock_response(401))
        with patch("mg_client._client", return_value=client):
            with pytest.raises(httpx.HTTPStatusError):
                await mg_client.fetch_runtime()


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_posts_to_sessions_endpoint(self):
        client = _client_mock(
            "post", _mock_response(200, {"id": "sess_123"})
        )
        with patch("mg_client._client", return_value=client):
            session_id = await mg_client.create_session("alice@example.com")
        assert session_id == "sess_123"
        path = client.post.call_args[0][0]
        body = client.post.call_args[1]["json"]
        assert path == "/api/sessions"
        assert body["channelType"] == "voice"
        assert body["userIdentifier"] == "alice@example.com"

    @pytest.mark.asyncio
    async def test_defaults_to_voice_caller_identifier(self):
        client = _client_mock(
            "post", _mock_response(200, {"id": "sess_x"})
        )
        with patch("mg_client._client", return_value=client):
            await mg_client.create_session()
        body = client.post.call_args[1]["json"]
        assert body["userIdentifier"] == "voice-caller"


class TestCompleteSession:
    @pytest.mark.asyncio
    async def test_swallows_http_errors_silently(self):
        """An ungraceful PATCH failure must never bubble out — we're in
        cleanup territory, and a flaky API call shouldn't crash the worker
        after a successful conversation."""
        client = _client_mock("patch", _mock_response(500))
        with patch("mg_client._client", return_value=client):
            await mg_client.complete_session("sess_x")

    @pytest.mark.asyncio
    async def test_marks_status_in_payload(self):
        client = _client_mock("patch", _mock_response(200))
        with patch("mg_client._client", return_value=client):
            await mg_client.complete_session("sess_x", status="abandoned")
        assert client.patch.call_args[1]["json"] == {"status": "abandoned"}
