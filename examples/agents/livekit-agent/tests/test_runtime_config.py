"""Tests for ADR-015 — runtime fetch of the compiled prompt.

Covers the entrypoint's ``_resolve_instructions_override`` resolver and the
BuildProAgent's ``instructions_override`` plumbing. These are isolated from
LiveKit / asyncio internals — the agent constructor is exercised directly
without starting an AgentSession.
"""

from unittest.mock import AsyncMock, patch

import pytest

import config
from agent import _resolve_instructions_override
from buildpro import BuildProAgent


class TestResolveInstructionsOverride:
    """The entrypoint helper that decides local vs remote at session start."""

    @pytest.mark.asyncio
    async def test_returns_none_when_source_is_local(self):
        # Default config — INSTRUCTIONS_SOURCE=local — must never hit the network
        with patch.object(config, "INSTRUCTIONS_SOURCE", "local"):
            with patch(
                "agent.mg_client.get_runtime_config", new=AsyncMock()
            ) as mocked:
                result = await _resolve_instructions_override()
                assert result is None
                mocked.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_compiled_prompt_when_remote(self):
        with patch.object(config, "INSTRUCTIONS_SOURCE", "remote"):
            with patch(
                "agent.mg_client.get_runtime_config",
                new=AsyncMock(
                    return_value={
                        "compiledInstructions": "Be Sam. Be brief.",
                        "compiledAt": "2026-06-08T12:00:00.000Z",
                    }
                ),
            ):
                result = await _resolve_instructions_override()

        assert result == "Be Sam. Be brief."

    @pytest.mark.asyncio
    async def test_falls_back_when_fetch_returns_none(self):
        # mg_client returns None on any failure (network, 4xx, 5xx, bad JSON)
        # — the resolver must surface that as a "fall back to local" signal
        with patch.object(config, "INSTRUCTIONS_SOURCE", "remote"):
            with patch(
                "agent.mg_client.get_runtime_config",
                new=AsyncMock(return_value=None),
            ):
                result = await _resolve_instructions_override()

        assert result is None

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_is_null(self):
        # Agent exists on MG but has no compiled prompt yet — same fallback path
        with patch.object(config, "INSTRUCTIONS_SOURCE", "remote"):
            with patch(
                "agent.mg_client.get_runtime_config",
                new=AsyncMock(
                    return_value={
                        "compiledInstructions": None,
                        "compiledAt": None,
                    }
                ),
            ):
                result = await _resolve_instructions_override()

        assert result is None

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_is_empty_string(self):
        # An explicitly empty compiled prompt isn't useful — treat as missing
        with patch.object(config, "INSTRUCTIONS_SOURCE", "remote"):
            with patch(
                "agent.mg_client.get_runtime_config",
                new=AsyncMock(return_value={"compiledInstructions": ""}),
            ):
                result = await _resolve_instructions_override()

        assert result is None


class TestBuildProAgentInstructionsOverride:
    """Agent construction with and without a compiled prompt override."""

    def test_default_uses_baked_in_prompt(self):
        agent = BuildProAgent(session_id="sess_1", user_email="x@y.com")
        # BuildPro/Sam markers come from prompts/base.py
        assert "Sam" in agent.instructions or "BuildPro" in agent.instructions

    def test_override_replaces_baked_in_prompt(self):
        agent = BuildProAgent(
            session_id="sess_1",
            user_email="x@y.com",
            instructions_override="You are Mia from ClearHealth.",
        )
        assert "Mia" in agent.instructions
        assert "ClearHealth" in agent.instructions
        # The baked-in identity must be gone — drift would silently mix prompts
        assert "BuildPro" not in agent.instructions

    def test_override_interpolates_session_id(self):
        agent = BuildProAgent(
            session_id="sess_runtime_42",
            user_email="caller@x.com",
            instructions_override=(
                "Session: {{mg_session_id}} / Email: {{userEmail}}"
            ),
        )
        assert "sess_runtime_42" in agent.instructions
        assert "caller@x.com" in agent.instructions
        # Raw placeholder must not leak through
        assert "{{mg_session_id}}" not in agent.instructions

    def test_explicit_none_override_keeps_baked_in(self):
        agent = BuildProAgent(
            session_id="sess_1",
            user_email="x@y.com",
            instructions_override=None,
        )
        assert "Sam" in agent.instructions or "BuildPro" in agent.instructions
