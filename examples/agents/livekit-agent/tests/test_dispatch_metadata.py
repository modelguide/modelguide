"""Dispatch-metadata contract tests — the Python side of ADR-014.

The ModelGuide API stuffs the latest compiled prompt into the LiveKit job
metadata when "Talk to agent" is clicked. This worker is responsible for
honouring it (instead of running its baked-in BuildPro template) so the
operator hears the prompt they just clicked Compile on.

These tests lock in two contracts:

  1. ``parse_dispatch_metadata`` — robust JSON parsing that never throws,
     so a malformed (or absent) metadata blob can't crash the entrypoint.
  2. ``BuildProAgent(instructions_override=...)`` — when a compiled prompt
     arrives in dispatch metadata, the agent uses it verbatim. When it
     doesn't, the agent falls back to the legacy ``build_system_prompt``
     template. No silent string surgery.
"""

from __future__ import annotations

import json

import pytest

from agent import parse_dispatch_metadata
from buildpro import BuildProAgent


# ---------------------------------------------------------------------------
# parse_dispatch_metadata
# ---------------------------------------------------------------------------


class TestParseDispatchMetadata:
    def test_returns_empty_dict_for_none(self):
        assert parse_dispatch_metadata(None) == {}

    def test_returns_empty_dict_for_empty_string(self):
        assert parse_dispatch_metadata("") == {}

    def test_parses_valid_voice_test_payload(self):
        raw = json.dumps(
            {
                "mode": "voice-test",
                "agentName": "acme_voice_v1",
                "session_id": "sess-abc",
                "user_identifier": "admin@example.com",
                "email": "admin@example.com",
                "compiled_instructions": "You are Sam.",
                "compiled_at": "2026-05-17T12:00:00.000Z",
            }
        )
        md = parse_dispatch_metadata(raw)
        assert md["agentName"] == "acme_voice_v1"
        assert md["compiled_instructions"] == "You are Sam."
        assert md["compiled_at"] == "2026-05-17T12:00:00.000Z"

    def test_returns_empty_dict_for_invalid_json(self):
        # A worker crash on bad metadata would take the whole call down;
        # better to fall back to the baked-in profile and stay reachable.
        assert parse_dispatch_metadata("{not json") == {}

    def test_returns_empty_dict_for_non_object_json(self):
        # JSON "null", a list, a number — none are usable as a metadata
        # dict. Treat them like a missing payload.
        assert parse_dispatch_metadata("null") == {}
        assert parse_dispatch_metadata("[1,2,3]") == {}
        assert parse_dispatch_metadata('"a string"') == {}


# ---------------------------------------------------------------------------
# BuildProAgent — instructions override
# ---------------------------------------------------------------------------


class TestBuildProAgentInstructionsOverride:
    """Verifies the ``instructions_override`` keyword wired up for ADR-014."""

    def test_uses_override_verbatim_when_provided(self):
        # The whole point of voice-test: what the operator just compiled
        # is what the agent runs. No template interpolation, no trimming.
        override = "  # Custom\n\nYou are a sandwich expert. Speak briefly.\n"
        agent = BuildProAgent(
            session_id="sess_1",
            user_email="ops@example.com",
            instructions_override=override,
        )
        assert agent.instructions == override

    def test_falls_back_to_template_when_override_is_none(self):
        # No compiled prompt → use the legacy hardcoded BuildPro template
        # so cold-start dispatches (agent never compiled) still answer.
        agent = BuildProAgent(
            session_id="sess_2",
            user_email="ops@example.com",
            instructions_override=None,
        )
        assert "ops@example.com" in agent.instructions
        assert "sess_2" in agent.instructions

    def test_falls_back_to_template_for_empty_string(self):
        # An empty-string override means "no prompt" — falling back to the
        # template is safer than letting the LLM run with `""` instructions.
        agent = BuildProAgent(
            session_id="sess_3",
            user_email="ops@example.com",
            instructions_override="",
        )
        # The template interpolates the session id, so this is a cheap
        # proxy for "we used the template, not the override".
        assert "sess_3" in agent.instructions
        assert agent.instructions != ""

    def test_override_does_not_leak_template_placeholders(self):
        # Regression guard against a naive "concat override + template"
        # implementation that would smuggle BuildPro's brand into the
        # compiled prompt.
        override = "You are an HVAC dispatcher."
        agent = BuildProAgent(
            session_id="sess_4",
            user_email="ops@example.com",
            instructions_override=override,
        )
        assert agent.instructions == override
        assert "BuildPro" not in agent.instructions
        assert "Sam" not in agent.instructions

    @pytest.mark.parametrize(
        "raw_meta,expected_used",
        [
            # The override path is taken: instructions == compiled value
            (
                {"compiled_instructions": "compiled-from-api"},
                "compiled-from-api",
            ),
        ],
    )
    def test_end_to_end_metadata_to_instructions(self, raw_meta, expected_used):
        """End-to-end: parse metadata → construct agent → run with that prompt.

        Mirrors what ``agent.entrypoint`` does, minus the LiveKit ceremony.
        """
        md = parse_dispatch_metadata(json.dumps(raw_meta))
        override = md.get("compiled_instructions")
        agent = BuildProAgent(
            session_id="sess_e2e",
            user_email="ops@example.com",
            instructions_override=override,
        )
        assert agent.instructions == expected_used
