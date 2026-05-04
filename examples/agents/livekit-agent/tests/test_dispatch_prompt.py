"""Worker-side contract for ADR-015: voice-test prompt override.

The ModelGuide API may attach a `compiledInstructions` field to the
dispatch metadata when an admin clicks "Talk to agent" from the
dashboard. The worker honors it as the system prompt for that single
session, falling back to the baked profile prompt when the field is
absent or empty.

These tests pin down:

  1. The pure helper that decides which prompt to use.
  2. ``BuildProAgent(instructions_override=...)`` swaps the baked
     prompt out for the override.
  3. Empty / whitespace overrides do NOT win — they fall back to the
     baked prompt. This avoids "I shipped an empty prompt and the
     agent went mute" failure modes.

Cross-reference: ``modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts``
locks the producer side of the same contract.
"""

from __future__ import annotations

import pytest

from buildpro import BuildProAgent
from prompt_override import resolve_instructions


# ---------------------------------------------------------------------------
# resolve_instructions — the pure helper used by agent.py entrypoint
# ---------------------------------------------------------------------------


class TestResolveInstructions:
    def test_returns_override_when_dispatch_carries_compiled_instructions(self):
        baked = "You are the baked profile prompt."
        override = "You are the freshly compiled prompt."
        result = resolve_instructions({"compiledInstructions": override}, baked)
        assert result == override

    def test_falls_back_to_baked_when_field_missing(self):
        baked = "You are the baked profile prompt."
        result = resolve_instructions({"agentName": "x", "session_id": "s"}, baked)
        assert result == baked

    def test_falls_back_when_override_is_empty_string(self):
        # Empty string MUST NOT win — the compiler may emit "" for an
        # un-configured agent, and silently muting the agent is worse
        # than running on the baked prompt.
        baked = "Baked."
        result = resolve_instructions({"compiledInstructions": ""}, baked)
        assert result == baked

    def test_falls_back_when_override_is_whitespace(self):
        baked = "Baked."
        result = resolve_instructions({"compiledInstructions": "   \n\t  "}, baked)
        assert result == baked

    def test_falls_back_when_dispatch_metadata_is_none(self):
        # Worker tolerates jobs with no metadata at all (e.g. operator
        # using `lk dispatch` from CLI without a JSON blob).
        baked = "Baked."
        assert resolve_instructions(None, baked) == baked

    def test_falls_back_when_override_is_not_a_string(self):
        # JSON.parse on the worker side could yield numbers / nested
        # objects if a producer corrupted the payload. Treat anything
        # non-string as "no override".
        baked = "Baked."
        for bogus in (123, ["nope"], {"nested": "bad"}, True):
            assert resolve_instructions({"compiledInstructions": bogus}, baked) == baked

    def test_does_not_strip_the_override_content(self):
        # Whitespace inside an otherwise valid prompt must be preserved
        # verbatim — the LLM uses it for formatting cues.
        override = "Line 1\n\n  Line 2 with leading spaces\n"
        result = resolve_instructions({"compiledInstructions": override}, "baked")
        assert result == override


# ---------------------------------------------------------------------------
# BuildProAgent — instructions_override parameter
# ---------------------------------------------------------------------------


class TestBuildProAgentOverride:
    def test_uses_override_when_provided(self):
        agent = BuildProAgent(
            session_id="s",
            user_email="e@x.com",
            instructions_override="You are TestBot. Say only 'hi'.",
        )
        assert agent.instructions == "You are TestBot. Say only 'hi'."

    def test_falls_back_to_baked_when_override_is_none(self):
        # session_id and user_email are interpolated into the baked
        # prompt, so the baked path is observably different from any
        # override.
        agent = BuildProAgent(
            session_id="sess_abc",
            user_email="alice@example.com",
            instructions_override=None,
        )
        # The baked prompt mentions both — see prompts/base.py.
        assert "sess_abc" in agent.instructions
        assert "alice@example.com" in agent.instructions

    def test_falls_back_when_override_is_empty(self):
        agent = BuildProAgent(
            session_id="sess_abc",
            user_email="alice@example.com",
            instructions_override="",
        )
        assert "sess_abc" in agent.instructions

    def test_default_constructor_still_uses_baked(self):
        # Backwards compatibility — kwargs without override.
        agent = BuildProAgent(session_id="sess_def", user_email="bob@x.com")
        assert "sess_def" in agent.instructions
        assert "bob@x.com" in agent.instructions
