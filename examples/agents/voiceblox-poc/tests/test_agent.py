"""Tests for the prompt-resolution logic.

The agent boots with whatever GET /me returns. These tests pin two
behaviors:

1. When ModelGuide has a compiled prompt, the worker uses it verbatim.
2. When ModelGuide returns null (uncompiled agent) or the fetch errors,
   the worker falls back to a baked-in default so the call still works.
"""

from unittest.mock import AsyncMock, patch

import pytest

from voiceblox_agent import DEFAULT_PROMPT, resolve_system_prompt


class TestResolveSystemPrompt:
    @pytest.mark.asyncio
    async def test_uses_compiled_instructions_when_present(self):
        fake_cfg = {
            "id": "agt_1",
            "slug": "test-agent",
            "compiledInstructions": "You are Sherlock Holmes.",
            "promptConfig": {},
        }
        with patch("voiceblox_agent.fetch_agent_config", AsyncMock(return_value=fake_cfg)):
            prompt, source = await resolve_system_prompt()

        assert prompt == "You are Sherlock Holmes."
        assert source == "compiled"

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_is_null(self):
        fake_cfg = {
            "id": "agt_1",
            "slug": "test-agent",
            "compiledInstructions": None,
            "promptConfig": {},
        }
        with patch("voiceblox_agent.fetch_agent_config", AsyncMock(return_value=fake_cfg)):
            prompt, source = await resolve_system_prompt()

        assert prompt == DEFAULT_PROMPT
        assert source == "fallback-uncompiled"

    @pytest.mark.asyncio
    async def test_falls_back_when_fetch_errors(self):
        # If MG is down at boot we keep the call working with the default
        # prompt rather than dropping it on the floor. The caller still
        # gets connected; the operator sees the error in logs.
        with patch(
            "voiceblox_agent.fetch_agent_config",
            AsyncMock(side_effect=RuntimeError("boom")),
        ):
            prompt, source = await resolve_system_prompt()

        assert prompt == DEFAULT_PROMPT
        assert source == "fallback-error"

    @pytest.mark.asyncio
    async def test_appends_persona_when_present_in_prompt_config(self):
        # Configuration tab persona/language fields are appended after the
        # compiled prompt so admins can experiment with voice/persona without
        # recompiling SOPs.
        fake_cfg = {
            "id": "agt_1",
            "slug": "test-agent",
            "compiledInstructions": "Base prompt.",
            "promptConfig": {"persona": "Speak like a pirate.", "language": "English"},
        }
        with patch("voiceblox_agent.fetch_agent_config", AsyncMock(return_value=fake_cfg)):
            prompt, source = await resolve_system_prompt()

        assert prompt.startswith("Base prompt.")
        assert "pirate" in prompt
        assert "English" in prompt
        assert source == "compiled"
