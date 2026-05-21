"""Tests for the compiled-prompt override flow.

The worker normally uses the system prompt baked into its profile module
(see ``prompts/base.py``). When MG ships a freshly-compiled prompt in
dispatch metadata, the worker overrides the baked prompt for the
duration of that call so the user can test the *latest* prompt without
redeploying. See ADR-015 and ``buildVoiceTestDispatchMetadata`` on the
API side.

These tests pin the two pure helpers that make the override safe:

  * ``extract_instructions_override(metadata)`` — pulls the field out
    of the dispatch-metadata dict (and rejects garbage shapes)
  * ``resolve_instructions(default, override)`` — picks which prompt
    wins, falling back to the baked default when the override is empty

The agent.py / mcp_agent.py wiring layers on top of these. If either
helper drifts, every call either silently keeps the old prompt or
explodes on construction — both far worse than a unit test failure.
"""

from __future__ import annotations

from agent import extract_instructions_override
from mcp_agent import resolve_instructions


# ---------------------------------------------------------------------------
# resolve_instructions — picks the effective system prompt
# ---------------------------------------------------------------------------


class TestResolveInstructions:
    def test_override_wins_when_non_empty(self):
        assert (
            resolve_instructions("baked", "from-metadata") == "from-metadata"
        )

    def test_falls_back_when_override_is_none(self):
        assert resolve_instructions("baked", None) == "baked"

    def test_falls_back_when_override_is_empty_string(self):
        assert resolve_instructions("baked", "") == "baked"

    def test_falls_back_when_override_is_whitespace(self):
        # A whitespace-only override would silently nuke the agent's
        # persona — keep the baked prompt instead.
        assert resolve_instructions("baked", "   \n\t  ") == "baked"

    def test_preserves_internal_whitespace_in_override(self):
        # We trim for the "is this real content?" check but the prompt
        # itself must be returned verbatim so newlines/code-fences survive.
        override = "You are Sam.\n\n  Greet the user."
        assert resolve_instructions("baked", override) == override

    def test_override_can_be_much_longer_than_default(self):
        # No length cap on the worker side — the API already enforced
        # the 32KB ceiling before putting it on the wire.
        override = "x" * 30_000
        assert resolve_instructions("baked", override) == override


# ---------------------------------------------------------------------------
# extract_instructions_override — pulls the field out of dispatch metadata
# ---------------------------------------------------------------------------


class TestExtractInstructionsOverride:
    def test_returns_string_when_present(self):
        md = {"mode": "voice-test", "instructions": "You are Sam."}
        assert extract_instructions_override(md) == "You are Sam."

    def test_returns_none_when_key_missing(self):
        md = {"mode": "voice-test", "agentName": "buildpro_v1"}
        assert extract_instructions_override(md) is None

    def test_returns_none_when_metadata_is_empty(self):
        assert extract_instructions_override({}) is None

    def test_returns_none_when_metadata_is_not_a_dict(self):
        # Dispatch metadata sometimes arrives as ``None`` (job has no
        # metadata) or — paranoid — as a list if a broken sender ever
        # PUT-s the wrong shape. Don't crash the entrypoint over it.
        assert extract_instructions_override(None) is None  # type: ignore[arg-type]
        assert extract_instructions_override([]) is None  # type: ignore[arg-type]
        assert extract_instructions_override("not-a-dict") is None  # type: ignore[arg-type]

    def test_returns_none_when_value_is_not_a_string(self):
        # A misconfigured sender that puts an object or number under
        # "instructions" must not crash the worker — fall back to the
        # baked prompt.
        assert extract_instructions_override({"instructions": 42}) is None
        assert extract_instructions_override({"instructions": ["a"]}) is None
        assert extract_instructions_override({"instructions": None}) is None

    def test_returns_none_when_value_is_empty_or_whitespace(self):
        # Matches the API-side guard so the two sides agree on "no
        # override" (otherwise a whitespace override would replace the
        # baked prompt with literal whitespace).
        assert extract_instructions_override({"instructions": ""}) is None
        assert (
            extract_instructions_override({"instructions": "   \n\t  "}) is None
        )

    def test_preserves_internal_whitespace(self):
        # We strip for the emptiness check but the returned value keeps
        # its newlines/spacing so the prompt formatting survives.
        prompt = "Line 1.\n\nLine 3 with    spaces."
        assert extract_instructions_override({"instructions": prompt}) == prompt

    def test_returns_none_for_whitespace_padded_input(self):
        # Surrounding whitespace alone (no real content after strip) is
        # treated as empty.
        assert extract_instructions_override({"instructions": "\n  "}) is None

    def test_keeps_leading_whitespace_when_content_exists(self):
        # If the prompt has real content but is padded, return the
        # original value — don't silently mutate the prompt the operator
        # compiled.
        prompt = "  You are Sam.  "
        assert extract_instructions_override({"instructions": prompt}) == prompt
