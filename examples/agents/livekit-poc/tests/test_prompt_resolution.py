"""Prompt resolution — the worker half of the ADR-015 contract.

The voice-test endpoint in ``modelguide-api`` ships the agent's compiled
prompt as ``instructions`` inside the dispatch metadata JSON blob. The POC
worker MUST pick that up when present, and fall back to its baked-in
default when absent. These tests lock that resolution order in place so a
silent refactor can't break the "talk to the latest compiled prompt" loop.

Mirrors ``modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts``:
the TS side asserts the API encodes the field, the Python side asserts the
worker decodes it. There is no type system connecting the two halves; the
two test files ARE the contract.
"""

import json

import pytest

from prompt_resolver import (
    DEFAULT_INSTRUCTIONS,
    PromptResolution,
    resolve_instructions,
)


class TestResolveFromDispatchMetadata:
    def test_uses_dispatch_instructions_when_present(self):
        compiled = "You are Sam — a helpful contractor supply agent."
        md = json.dumps(
            {
                "mode": "voice-test",
                "agentName": "buildpro-sam",
                "session_id": "sess_1",
                "user_identifier": "ops@example.com",
                "email": "ops@example.com",
                "instructions": compiled,
            }
        )
        out = resolve_instructions(metadata_json=md)
        assert out.instructions == compiled
        assert out.source == "dispatch_metadata"

    def test_falls_back_to_default_when_no_instructions_field(self):
        # The legacy dispatch shape (pre-ADR-015) has no `instructions`
        # field. The POC worker must still boot and use its baked-in
        # default so existing voice tests don't regress.
        md = json.dumps(
            {
                "mode": "voice-test",
                "agentName": "buildpro-sam",
                "session_id": "sess_2",
                "user_identifier": "ops@example.com",
                "email": "ops@example.com",
            }
        )
        out = resolve_instructions(metadata_json=md)
        assert out.instructions == DEFAULT_INSTRUCTIONS
        assert out.source == "default"

    def test_falls_back_to_default_for_empty_instructions(self):
        # The API side trims and treats empty/whitespace as absent (see
        # `buildVoiceTestDispatchMetadata`). The worker still defends in
        # depth: if an empty string ever sneaks through (e.g. a different
        # dispatcher), don't null out the default with nothing.
        for empty in ("", "   ", "\n\n", "\t  \n"):
            md = json.dumps({"instructions": empty})
            out = resolve_instructions(metadata_json=md)
            assert out.instructions == DEFAULT_INSTRUCTIONS
            assert out.source == "default"

    def test_falls_back_for_missing_metadata(self):
        # LiveKit jobs without a metadata blob (or with None) are valid —
        # e.g. local `lk dispatch` calls during development. The worker
        # must still boot.
        out = resolve_instructions(metadata_json=None)
        assert out.instructions == DEFAULT_INSTRUCTIONS
        assert out.source == "default"

        out = resolve_instructions(metadata_json="")
        assert out.instructions == DEFAULT_INSTRUCTIONS
        assert out.source == "default"

    def test_falls_back_for_malformed_metadata(self):
        # A non-JSON metadata blob is a misconfigured dispatcher, not a
        # user-facing error. Logging at the call site is fine; here we
        # just guarantee the worker keeps running.
        out = resolve_instructions(metadata_json="not json {{")
        assert out.instructions == DEFAULT_INSTRUCTIONS
        assert out.source == "default"

    def test_falls_back_when_metadata_is_a_json_list(self):
        # Defensive: a non-object top-level JSON value can't carry our
        # field, so it's equivalent to "no override".
        out = resolve_instructions(metadata_json='["instructions", "x"]')
        assert out.instructions == DEFAULT_INSTRUCTIONS
        assert out.source == "default"

    def test_non_string_instructions_field_is_ignored(self):
        # A list / number / null in `instructions` is malformed. Don't
        # try to stringify it — the LLM would receive garbage. Use the
        # default and let the worker logs surface the misconfiguration.
        for bad in (123, None, ["a", "b"], {"x": 1}, True):
            md = json.dumps({"instructions": bad})
            out = resolve_instructions(metadata_json=md)
            assert out.instructions == DEFAULT_INSTRUCTIONS, (
                f"bad value {bad!r} should fall back to default"
            )

    def test_preserves_verbatim_whitespace_when_non_empty(self):
        # Symmetric with the TS test "survives JSON round-trip with a long
        # prompt": the worker should not strip / normalize the prompt the
        # API sent. The prompt compiler's output is authoritative.
        compiled = "  You are Sam.\n\n  Be terse.\n"
        md = json.dumps({"instructions": compiled})
        out = resolve_instructions(metadata_json=md)
        assert out.instructions == compiled


class TestExplicitOverride:
    """Helpful for `python -m agent connect --metadata '{...}'` and tests."""

    def test_explicit_override_wins_over_dispatch(self):
        # If the caller passes an explicit override (e.g. a test harness),
        # it short-circuits both the dispatch metadata and the default.
        md = json.dumps({"instructions": "from dispatch"})
        out = resolve_instructions(
            metadata_json=md,
            override="explicit override",
        )
        assert out.instructions == "explicit override"
        assert out.source == "override"

    def test_empty_override_falls_through_to_dispatch(self):
        # An empty/whitespace override is not a real override.
        md = json.dumps({"instructions": "from dispatch"})
        out = resolve_instructions(metadata_json=md, override="   ")
        assert out.instructions == "from dispatch"
        assert out.source == "dispatch_metadata"


class TestResolutionShape:
    def test_returns_resolution_dataclass(self):
        out = resolve_instructions(metadata_json=None)
        assert isinstance(out, PromptResolution)

    def test_resolution_carries_source_for_logging(self):
        # The `source` field is what the worker logs at session-start so
        # an operator can tell whether they're testing the compiled prompt
        # or the baked-in default. Lock the three possible values.
        sources = set()
        sources.add(resolve_instructions(metadata_json=None).source)
        sources.add(
            resolve_instructions(metadata_json=json.dumps({"instructions": "x"})).source
        )
        sources.add(
            resolve_instructions(metadata_json=None, override="x").source
        )
        assert sources == {"default", "dispatch_metadata", "override"}


@pytest.mark.parametrize(
    "metadata, expected_source",
    [
        ({"instructions": "x"}, "dispatch_metadata"),
        ({}, "default"),
        ({"instructions": ""}, "default"),
        ({"instructions": None}, "default"),
        ({"mode": "voice-test"}, "default"),
    ],
)
def test_resolution_source_table(metadata, expected_source):
    out = resolve_instructions(metadata_json=json.dumps(metadata))
    assert out.source == expected_source
