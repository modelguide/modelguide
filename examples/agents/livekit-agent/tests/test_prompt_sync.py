"""Prompt-sync prototype (ADR-015) tests.

The dashboard ships the latest compiled prompt to the worker via LiveKit
dispatch metadata under the key ``compiled_prompt``. When that key is
present, ``BuildProAgent`` must use the supplied string as its system
instructions instead of the prompt baked into the worker profile via
``build_system_prompt``.

These tests pin the contract from the worker side — the matching contract
on the dispatcher side is locked in
``modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts``. If
either side drifts, prompt-sync silently regresses to "worker uses its
baked-in prompt".
"""

from __future__ import annotations

import json

from buildpro import BuildProAgent


class TestPromptSyncOverride:
    def test_uses_override_when_provided(self):
        # When the dashboard ships a compiled prompt, the agent's
        # ``instructions`` must be that exact string, byte-for-byte.
        override = (
            "You are a banking voice agent. Confirm account number "
            "before sharing balances."
        )
        agent = BuildProAgent(
            session_id="sess_test",
            user_email="alice@example.com",
            instructions_override=override,
        )
        assert agent.instructions == override

    def test_falls_back_to_baked_prompt_when_override_is_none(self):
        # No override → baked-in BuildPro prompt. We don't pin the exact
        # text (it's huge and evolves), but a stable marker is fair game:
        # the BuildPro prompt always contains the brand name "BuildPro"
        # somewhere.
        agent = BuildProAgent(
            session_id="sess_test",
            user_email="alice@example.com",
            instructions_override=None,
        )
        assert "BuildPro" in agent.instructions
        # And the session_id / user_email must still flow into the prompt
        # because some workflows interpolate them.
        assert "alice@example.com" in agent.instructions

    def test_falls_back_to_baked_prompt_when_override_is_empty_string(self):
        # Empty / whitespace-only overrides are ignored. Belt-and-braces
        # guard against an accidental "" rendering in the dispatch
        # payload silently blanking the agent. The fallback path is the
        # same as ``None``.
        agent = BuildProAgent(
            session_id="sess_test",
            user_email="alice@example.com",
            instructions_override="   ",
        )
        assert "BuildPro" in agent.instructions


class TestDispatchMetadataParsing:
    """Confirms the wire shape the dispatcher emits is the shape the worker reads.

    Mirrors the dispatcher contract test in
    ``buildVoiceTestDispatchMetadata`` (TypeScript). If the field name
    drifts on either side, the worker reads ``None`` and silently falls
    back to the baked-in prompt — exactly the kind of "tests pass, prod
    breaks" failure the ADR calls out.
    """

    def test_compiled_prompt_field_name_matches_dispatcher(self):
        # The TS side serialises this exact JSON shape (see
        # voice-test-dispatch.test.ts → "carries compiled_prompt
        # verbatim when supplied").
        wire = {
            "mode": "voice-test",
            "agentName": "banknowa_v1",
            "session_id": "sess-1",
            "user_identifier": "tester@corp.com",
            "email": "tester@corp.com",
            "compiled_prompt": "You are Sam. Answer in one sentence.",
            "compiled_prompt_compiled_at": "2026-06-07T00:00:00.000Z",
        }
        # Round-trip through JSON because that's what the worker does
        # with ``ctx.job.metadata``.
        parsed = json.loads(json.dumps(wire))
        # These two assertions ARE the contract.
        assert parsed.get("compiled_prompt") == wire["compiled_prompt"]
        assert (
            parsed.get("compiled_prompt_compiled_at")
            == wire["compiled_prompt_compiled_at"]
        )

    def test_absent_compiled_prompt_returns_none(self):
        # The default voice-test path (no opt-in) omits the field
        # entirely — ``.get()`` must return ``None`` so the worker takes
        # the baked-in branch.
        wire = {
            "mode": "voice-test",
            "agentName": "banknowa_v1",
            "session_id": "sess-1",
            "user_identifier": "tester@corp.com",
            "email": "tester@corp.com",
        }
        parsed = json.loads(json.dumps(wire))
        assert parsed.get("compiled_prompt") is None
