"""Tests for prompt_loader — the heart of the POC.

The POC worker's only reason to exist is "always boot with the latest
compiled prompt from ModelGuide." That means three behaviours must hold:

  1. When dispatch metadata carries an ``agent_id``, the loader fetches
     ``GET /api/agents/{agent_id}`` and returns ``compiledInstructions``.
  2. When the agent has no compiled prompt yet (operator hasn't clicked
     "Compile" once), the loader falls back to a clearly-labelled default
     so the call still goes through and the operator can hear *something*.
  3. When the API call itself fails (network, 401, 500), the loader still
     falls back rather than killing the LiveKit session — a hung worker
     is worse than a generic prompt for a POC.

These were written before the implementation existed (TDD red phase). The
first run produces ImportError / AttributeError. The implementation in
``src/prompt_loader.py`` was then written to make these pass without
adding behaviour the tests don't cover.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import prompt_loader


def _fake_agent_response(compiled: str | None) -> dict:
    """Shape mirrors ``GET /api/agents/:id`` — only fields we actually read."""
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Test Agent",
        "slug": "test-agent",
        "compiledInstructions": compiled,
        "compiledAt": "2026-06-16T10:00:00Z" if compiled else None,
    }


class TestExtractAgentIdFromMetadata:
    """Dispatch metadata parsing — the worker reads ``agent_id`` from this."""

    def test_returns_agent_id_when_present(self):
        md = {"agent_id": "11111111-1111-1111-1111-111111111111", "mode": "voice-test"}
        assert (
            prompt_loader.extract_agent_id(md)
            == "11111111-1111-1111-1111-111111111111"
        )

    def test_returns_none_when_missing(self):
        # An old metadata payload (pre agent_id rollout) should fall back to
        # env var, not crash the entrypoint.
        assert prompt_loader.extract_agent_id({"mode": "voice-test"}) is None

    def test_returns_none_for_empty_string(self):
        # An empty string is *not* a valid UUID — treat it as missing so we
        # fall back rather than firing a 404 against the API.
        assert prompt_loader.extract_agent_id({"agent_id": ""}) is None

    def test_handles_non_dict_input(self):
        # ctx.job.metadata can be ``None`` when nothing was dispatched (e.g.
        # local ``console`` mode). Should not blow up.
        assert prompt_loader.extract_agent_id(None) is None


class TestLoadPromptFromAPI:
    """Happy path: the API returns ``compiledInstructions`` → we return them."""

    @pytest.mark.asyncio
    async def test_returns_compiled_instructions_on_success(self):
        agent_id = "11111111-1111-1111-1111-111111111111"
        body = _fake_agent_response("YOU ARE SAM, AN ORDERING ASSISTANT.")
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = body
        mock_response.raise_for_status = MagicMock()

        mock_get = AsyncMock(return_value=mock_response)
        with patch("prompt_loader._http_get", mock_get):
            result = await prompt_loader.load_prompt(agent_id)

        assert result.text == "YOU ARE SAM, AN ORDERING ASSISTANT."
        assert result.source == "modelguide-api"
        assert result.agent_id == agent_id

    @pytest.mark.asyncio
    async def test_calls_correct_url_with_auth(self):
        agent_id = "abc-123"
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = _fake_agent_response("hello")
        mock_response.raise_for_status = MagicMock()

        mock_get = AsyncMock(return_value=mock_response)
        with patch("prompt_loader._http_get", mock_get):
            await prompt_loader.load_prompt(agent_id)

        mock_get.assert_called_once()
        url_arg = mock_get.call_args[0][0]
        assert url_arg.endswith(f"/api/agents/{agent_id}")


class TestLoadPromptFallback:
    """When the API or the data is unusable, we MUST still return a prompt."""

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_instructions_is_null(self):
        # Agent exists but operator hasn't clicked "Compile" yet.
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = _fake_agent_response(None)
        mock_response.raise_for_status = MagicMock()

        with patch("prompt_loader._http_get", AsyncMock(return_value=mock_response)):
            result = await prompt_loader.load_prompt("any-id")

        assert result.source == "fallback"
        assert "compile" in result.text.lower(), (
            "fallback prompt should tell the listener the agent isn't compiled yet"
        )

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_instructions_is_empty_string(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = _fake_agent_response("")
        mock_response.raise_for_status = MagicMock()

        with patch("prompt_loader._http_get", AsyncMock(return_value=mock_response)):
            result = await prompt_loader.load_prompt("any-id")

        assert result.source == "fallback"

    @pytest.mark.asyncio
    async def test_falls_back_when_api_returns_http_error(self):
        # 401, 404, 500 — operator should still hear *something* so they can
        # debug from the room instead of a silent "Waking up agent..." spinner.
        request = httpx.Request("GET", "http://localhost:3000/api/agents/x")
        response = httpx.Response(500, request=request)
        err = httpx.HTTPStatusError("boom", request=request, response=response)

        with patch("prompt_loader._http_get", AsyncMock(side_effect=err)):
            result = await prompt_loader.load_prompt("any-id")

        assert result.source == "fallback"

    @pytest.mark.asyncio
    async def test_falls_back_when_api_is_unreachable(self):
        with patch(
            "prompt_loader._http_get",
            AsyncMock(side_effect=httpx.ConnectError("nope")),
        ):
            result = await prompt_loader.load_prompt("any-id")

        assert result.source == "fallback"

    @pytest.mark.asyncio
    async def test_falls_back_when_agent_id_is_none(self):
        # Dispatched without metadata at all, and no env var override available.
        result = await prompt_loader.load_prompt(None)
        assert result.source == "fallback"
        # No HTTP call should be attempted with a None ID.
        assert result.agent_id is None


class TestPromptResultShape:
    """The PromptResult struct is what the entrypoint reads — lock its shape."""

    def test_has_text_source_agent_id_fields(self):
        r = prompt_loader.PromptResult(
            text="hi",
            source="modelguide-api",
            agent_id="11111111-1111-1111-1111-111111111111",
        )
        assert r.text == "hi"
        assert r.source == "modelguide-api"
        assert r.agent_id == "11111111-1111-1111-1111-111111111111"

    def test_source_is_one_of_two_literals(self):
        # The agent.py entrypoint logs ``result.source`` so triaging "why did
        # I hear the fallback prompt" is one grep. If a third source is added
        # (e.g. "env-var-override"), the logging code needs to be updated too.
        for valid in ("modelguide-api", "fallback"):
            prompt_loader.PromptResult(text="x", source=valid, agent_id=None)
