"""Tests for the dispatch-metadata helpers.

These cover the Prompt Lab (ADR-015) override path on the worker side. The
helpers are deliberately pure (no livekit imports) so this file runs in a
plain Python environment — same pattern as test_prompts.py.

The MG-side dispatch contract is locked in
``modelguide-api/tests/unit/agents/prompt-lab-dispatch.test.ts``; this file
locks the worker-side read.
"""

import pytest

from dispatch import extract_prompt_override, select_instructions


class TestExtractPromptOverride:
    def test_missing_key_returns_none(self):
        assert extract_prompt_override({}) is None
        assert extract_prompt_override({"mode": "voice-test"}) is None

    def test_present_string_returns_verbatim(self):
        assert (
            extract_prompt_override({"prompt_override": "You are a pirate."})
            == "You are a pirate."
        )

    def test_preserves_multiline_unicode(self):
        prompt = "Line 1\nLine 2 — ünicode\n\t• indented 🦜\n"
        assert extract_prompt_override({"prompt_override": prompt}) == prompt

    def test_empty_string_treated_as_no_override(self):
        # Defensive: MG-side validation already rejects empty / whitespace,
        # but a worker rolled forward against an older MG should still fall
        # back cleanly to the baked-in profile prompt rather than starting
        # the agent with no instructions.
        assert extract_prompt_override({"prompt_override": ""}) is None
        assert extract_prompt_override({"prompt_override": "   \n\t"}) is None

    def test_non_string_returns_none(self):
        # Type guard — accept anything callable that says it's metadata
        # without crashing the worker.
        assert extract_prompt_override({"prompt_override": 123}) is None
        assert extract_prompt_override({"prompt_override": ["a"]}) is None
        assert extract_prompt_override({"prompt_override": None}) is None

    def test_none_metadata_returns_none(self):
        # The entrypoint passes {} when ctx.job.metadata is missing, but a
        # caller might pass None directly.
        assert extract_prompt_override(None) is None  # type: ignore[arg-type]


class TestSelectInstructions:
    def test_uses_override_when_set(self):
        result = select_instructions(
            override="You are a pirate.",
            default_factory=lambda: "default prompt",
        )
        assert result == "You are a pirate."

    def test_falls_back_when_override_is_none(self):
        called = {"n": 0}

        def factory():
            called["n"] += 1
            return "default prompt"

        result = select_instructions(override=None, default_factory=factory)
        assert result == "default prompt"
        assert called["n"] == 1

    def test_lazy_factory_not_called_when_override_set(self):
        # If the operator passes an override, we must not pay the cost of
        # building the default prompt — important for any factory that does
        # file I/O or template assembly.
        called = {"n": 0}

        def factory():
            called["n"] += 1
            return "default"

        select_instructions(override="hi", default_factory=factory)
        assert called["n"] == 0
