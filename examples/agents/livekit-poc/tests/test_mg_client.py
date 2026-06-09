"""Tests for the ModelGuide runtime-config client.

The POC's whole point is "the worker fetches the latest compiled prompt
from ModelGuide at session start so editing the prompt + clicking
'Talk to agent' just works." If `fetch_runtime_config` regresses, the
worker silently falls back to the default prompt and the loop breaks
without a test failure. These tests lock the contract from the worker
side.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import mg_client


def _runtime_config_payload(**overrides):
    payload = {
        "id": "agt_test_123",
        "name": "Test Agent",
        "slug": "test-agent",
        "modality": "voice",
        "isActive": True,
        "instructions": "You are Sam, a friendly contractor supply rep.",
        "promptConfig": {
            "persona": "Friendly contractor supply rep.",
            "language": "English only.",
            "fillerPhrases": ["One moment.", "Let me check."],
        },
        "compiledAt": "2026-06-09T12:00:00.000Z",
    }
    payload.update(overrides)
    return payload


def _make_response(status_code: int, body: dict):
    """Build a minimal stand-in for httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    resp.json = MagicMock(return_value=body)
    resp.text = json.dumps(body)
    if 200 <= status_code < 300:
        resp.raise_for_status = MagicMock(return_value=None)
    else:
        resp.raise_for_status = MagicMock(
            side_effect=Exception(f"HTTP {status_code}")
        )
    return resp


class TestFetchRuntimeConfig:
    @pytest.mark.asyncio
    async def test_returns_parsed_payload_on_success(self):
        payload = _runtime_config_payload()
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=_make_response(200, payload))

        with patch.object(mg_client, "_get_http_client", return_value=mock_client):
            config = await mg_client.fetch_runtime_config()

        assert config["id"] == "agt_test_123"
        assert config["instructions"].startswith("You are Sam")
        assert config["promptConfig"]["persona"] == "Friendly contractor supply rep."

    @pytest.mark.asyncio
    async def test_calls_the_self_endpoint_with_api_key(self):
        # Locks the URL — if someone moves the endpoint, this fails loudly.
        mock_client = MagicMock()
        mock_client.get = AsyncMock(
            return_value=_make_response(200, _runtime_config_payload())
        )

        with patch.object(mg_client, "_get_http_client", return_value=mock_client):
            await mg_client.fetch_runtime_config()

        mock_client.get.assert_awaited_once_with("/api/agents/me/runtime-config")

    @pytest.mark.asyncio
    async def test_returns_none_on_http_error_instead_of_raising(self):
        # The worker should fall back to a default prompt when the API
        # is unreachable, not crash mid-call. The agent stays usable
        # even if ModelGuide is briefly down.
        mock_client = MagicMock()
        mock_client.get = AsyncMock(side_effect=Exception("connection refused"))

        with patch.object(mg_client, "_get_http_client", return_value=mock_client):
            config = await mg_client.fetch_runtime_config()

        assert config is None

    @pytest.mark.asyncio
    async def test_returns_none_on_4xx_response(self):
        mock_client = MagicMock()
        mock_client.get = AsyncMock(
            return_value=_make_response(404, {"error": "not found"})
        )

        with patch.object(mg_client, "_get_http_client", return_value=mock_client):
            config = await mg_client.fetch_runtime_config()

        assert config is None

    @pytest.mark.asyncio
    async def test_handles_missing_instructions_field(self):
        # Agents that haven't been compiled yet return `instructions: null`.
        # The worker should accept that and fall back to defaults — not crash.
        payload = _runtime_config_payload(instructions=None)
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=_make_response(200, payload))

        with patch.object(mg_client, "_get_http_client", return_value=mock_client):
            config = await mg_client.fetch_runtime_config()

        assert config is not None
        assert config["instructions"] is None
