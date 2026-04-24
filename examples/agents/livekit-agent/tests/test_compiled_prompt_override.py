"""ADR-015 — compiled-prompt preview path.

When ModelGuide's `createVoiceTestSession(...mode: "preview")` dispatches a
worker, the job metadata carries `compiled_prompt` as a plain string. The
worker's entrypoint must:

1. Parse the metadata JSON without crashing on empty / malformed input.
2. Hand the prompt to the Agent subclass so it is used as `instructions`
   instead of the baked-in workflow prompt.

These tests pin both the parsing helper and the Agent constructor's
override path. They are the contract between the MG backend's
``buildVoiceTestDispatchMetadata`` (TS) and the Python worker.
"""

from __future__ import annotations

import pytest

from agent import parse_compiled_prompt_from_metadata
from buildpro import BuildProAgent


# ---------------------------------------------------------------------------
# parse_compiled_prompt_from_metadata — pure helper
# ---------------------------------------------------------------------------


class TestParseCompiledPromptFromMetadata:
    def test_returns_prompt_when_present(self):
        raw = '{"mode": "voice-test", "compiled_prompt": "You are helpful."}'
        assert parse_compiled_prompt_from_metadata(raw) == "You are helpful."

    def test_returns_none_when_field_missing(self):
        raw = '{"mode": "voice-test", "agentName": "x"}'
        assert parse_compiled_prompt_from_metadata(raw) is None

    def test_returns_none_for_empty_string_prompt(self):
        # Backend never emits an empty compiled_prompt field (see
        # buildVoiceTestDispatchMetadata), but belt-and-braces: if one sneaks
        # through we fall back to the baked-in prompt rather than wiping it.
        raw = '{"compiled_prompt": ""}'
        assert parse_compiled_prompt_from_metadata(raw) is None

    def test_returns_none_for_none_metadata(self):
        assert parse_compiled_prompt_from_metadata(None) is None

    def test_returns_none_for_empty_metadata(self):
        assert parse_compiled_prompt_from_metadata("") is None

    def test_returns_none_for_malformed_json(self):
        # A worker must never crash on bad metadata — missing prompt just
        # means "fall through to default behaviour".
        assert parse_compiled_prompt_from_metadata("not-json") is None
        assert parse_compiled_prompt_from_metadata("{not:valid}") is None

    def test_returns_none_when_json_is_not_an_object(self):
        assert parse_compiled_prompt_from_metadata('"a string"') is None
        assert parse_compiled_prompt_from_metadata("[1, 2, 3]") is None
        assert parse_compiled_prompt_from_metadata("42") is None

    def test_ignores_non_string_prompt_values(self):
        # Guards against a buggy emitter accidentally sending an int or object.
        assert parse_compiled_prompt_from_metadata('{"compiled_prompt": 42}') is None
        assert (
            parse_compiled_prompt_from_metadata('{"compiled_prompt": {"x": 1}}')
            is None
        )

    def test_preserves_prompt_whitespace_and_newlines(self):
        # The prompt is used verbatim as Agent instructions. Any trimming would
        # silently change behavior.
        raw = '{"compiled_prompt": "  Line 1\\n\\nLine 2  "}'
        assert parse_compiled_prompt_from_metadata(raw) == "  Line 1\n\nLine 2  "


# ---------------------------------------------------------------------------
# BuildProAgent — honors instructions_override
# ---------------------------------------------------------------------------


class TestBuildProAgentInstructionsOverride:
    @staticmethod
    def _make(instructions_override: str | None = None, session_id: str = "sess_test"):
        return BuildProAgent(
            session_id=session_id,
            user_email="tester@example.com",
            instructions_override=instructions_override,
        )

    def test_override_replaces_baked_in_prompt(self):
        override = "SYSTEM: You are a tiny echo bot. Repeat whatever the user says."
        agent = self._make(instructions_override=override)
        assert agent.instructions == override

    def test_override_used_literally_without_template_expansion(self):
        # The baked-in prompt expands `{{mg_session_id}}` etc. Overrides are
        # already-compiled — expanding them again would double-process.
        override = "This prompt has {{mg_session_id}} placeholder as a literal."
        agent = self._make(override, session_id="sess_xyz")
        assert agent.instructions == override
        assert "sess_xyz" not in agent.instructions

    def test_no_override_falls_through_to_baked_prompt(self):
        # Session id is interpolated by build_system_prompt — confirms we
        # took the default branch (and that the default still works).
        agent = self._make(instructions_override=None, session_id="sess_abc123")
        assert "sess_abc123" in agent.instructions

    def test_empty_string_override_falls_through_to_baked_prompt(self):
        # Mirrors the backend's "omit field when empty" contract. If an empty
        # string reaches the worker we still want a useful prompt, not "".
        agent = self._make(instructions_override="", session_id="sess_xyz")
        assert "sess_xyz" in agent.instructions
        assert agent.instructions != ""

    def test_override_does_not_break_tool_registry(self):
        # Override only swaps the prompt string; tools must still be wired.
        agent = self._make(instructions_override="anything")
        assert agent._tool_map  # non-empty dict
        for short_name in BuildProAgent.TOOL_NAMES:
            assert short_name in agent._tool_map
