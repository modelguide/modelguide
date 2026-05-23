"""Tests for the runtime-prompt voice-test POC (ADR-015).

The runtime-prompt scenario lets the dashboard "Sync & Test" flow push
the latest compiled prompt to the deployed LiveKit worker without a
redeploy. The contract:

1. ``mg_client.fetch_compiled_instructions(agent_id)`` issues a
   ``GET /api/agents/:id`` and returns the ``compiledInstructions`` field
   (or ``None`` if unset). Errors must not raise — the caller falls back
   to the baked-in prompt.

2. ``RuntimePromptAgent`` is a thin subclass of ``BuildProAgent`` whose
   constructor accepts an explicit ``instructions`` override. This way
   the POC reuses the same tool surface as production while letting the
   voice-test dispatcher inject the latest compiled prompt.

3. ``select_agent_class(dispatch_metadata)`` returns ``RuntimePromptAgent``
   when the dispatch metadata indicates a voice-test (``mode ==
   "voice-test"`` AND ``mg_agent_id`` present); otherwise it returns
   ``BuildProAgent``. That's the wiring point in ``agent.py``.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

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


def _mock_client(method: str = "get", response=None):
    client = AsyncMock()
    getattr(client, method).return_value = response or _mock_response(200)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


# ---------------------------------------------------------------------------
# mg_client.fetch_compiled_instructions
# ---------------------------------------------------------------------------


class TestFetchCompiledInstructions:
    @pytest.mark.asyncio
    async def test_returns_compiled_instructions_when_present(self):
        compiled = "You are an AI dental receptionist. Be concise."
        client = _mock_client(
            "get",
            _mock_response(200, {"id": "agt_123", "compiledInstructions": compiled}),
        )
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result == compiled
        # GET /api/agents/:id is the contract the API exposes.
        call_args = client.get.call_args
        assert "/api/agents/agt_123" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_returns_none_when_compiled_instructions_is_null(self):
        # An agent that's never been compiled has compiledInstructions=null.
        # The caller must treat this as "use the baked-in prompt".
        client = _mock_client(
            "get",
            _mock_response(200, {"id": "agt_123", "compiledInstructions": None}),
        )
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_field_absent(self):
        client = _mock_client("get", _mock_response(200, {"id": "agt_123"}))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result is None

    @pytest.mark.asyncio
    async def test_swallows_http_errors_and_returns_none(self):
        # If the API is down or auth fails, the voice-test must still work —
        # the worker falls back to its baked-in prompt rather than failing
        # the entire dispatch.
        client = _mock_client("get", _mock_response(500, text="server error"))
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result is None

    @pytest.mark.asyncio
    async def test_swallows_network_errors_and_returns_none(self):
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectError("connection refused")
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)

        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_empty_string(self):
        # Treat empty string the same as null — there's no point handing the
        # LLM a zero-character system prompt.
        client = _mock_client(
            "get",
            _mock_response(200, {"compiledInstructions": ""}),
        )
        with patch("mg_client.httpx.AsyncClient", return_value=client):
            result = await mg_client.fetch_compiled_instructions("agt_123")

        assert result is None


# ---------------------------------------------------------------------------
# RuntimePromptAgent
# ---------------------------------------------------------------------------


class TestRuntimePromptAgent:
    def test_uses_explicit_instructions_when_provided(self):
        from runtime_prompt_agent import RuntimePromptAgent

        agent = RuntimePromptAgent(
            session_id="sess_test",
            user_email="ops@example.com",
            instructions="You are a test agent for ADR-015.",
        )
        assert "You are a test agent for ADR-015." in agent.instructions

    def test_falls_back_to_buildpro_prompt_when_instructions_empty(self):
        # Belt-and-braces: if a future caller passes "" instead of None we
        # still need a usable system prompt. The base class's prompt
        # contains the BuildPro persona string.
        from runtime_prompt_agent import RuntimePromptAgent

        agent = RuntimePromptAgent(
            session_id="sess_test",
            user_email="ops@example.com",
            instructions="",
        )
        assert agent.instructions  # non-empty
        assert len(agent.instructions) > 50  # not just whitespace

    def test_falls_back_to_buildpro_prompt_when_instructions_none(self):
        from runtime_prompt_agent import RuntimePromptAgent

        agent = RuntimePromptAgent(
            session_id="sess_test",
            user_email="ops@example.com",
            instructions=None,
        )
        assert agent.instructions  # non-empty

    def test_inherits_buildpro_tool_set(self):
        # The POC must keep the same tool surface so existing MCP plumbing
        # (cart injection, reorder guardrails, etc.) still works.
        from buildpro import BuildProAgent
        from runtime_prompt_agent import RuntimePromptAgent

        agent = RuntimePromptAgent(
            session_id="s",
            user_email="e",
            instructions="x",
        )
        assert set(agent.TOOL_NAMES) == set(BuildProAgent.TOOL_NAMES)


# ---------------------------------------------------------------------------
# select_agent_class — the wiring point in agent.py
# ---------------------------------------------------------------------------


class TestSelectAgentClass:
    def test_returns_runtime_prompt_for_voice_test_with_agent_id(self):
        from buildpro import BuildProAgent  # noqa: F401
        from runtime_prompt_agent import RuntimePromptAgent, select_agent_class

        cls = select_agent_class(
            {"mode": "voice-test", "mg_agent_id": "agt_abc"}
        )
        assert cls is RuntimePromptAgent

    def test_returns_buildpro_for_outbound_dispatch(self):
        from buildpro import BuildProAgent
        from runtime_prompt_agent import select_agent_class

        cls = select_agent_class({"phone_number": "+15551234567"})
        assert cls is BuildProAgent

    def test_returns_buildpro_for_empty_metadata(self):
        from buildpro import BuildProAgent
        from runtime_prompt_agent import select_agent_class

        cls = select_agent_class({})
        assert cls is BuildProAgent

    def test_returns_buildpro_when_voice_test_missing_agent_id(self):
        # Defensive — a voice-test flag without an agent ID can't fetch a
        # prompt, so there's no point switching to the runtime-prompt
        # class. Falling back to BuildPro avoids a runtime crash.
        from buildpro import BuildProAgent
        from runtime_prompt_agent import select_agent_class

        cls = select_agent_class({"mode": "voice-test"})
        assert cls is BuildProAgent
