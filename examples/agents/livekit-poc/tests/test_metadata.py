"""Pytest contract for the dispatch-metadata parser.

This file is the Python half of the contract whose other half lives in
``modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts``. The TS test
asserts what the API *writes*; this file asserts what the worker *reads*. If
the field names ever drift between the two sides, one of the suites breaks
loudly instead of every dispatched call going silent at runtime.

See ADR-015 for the design rationale.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from metadata import DispatchMetadata, parse_dispatch_metadata  # noqa: E402


# ---------------------------------------------------------------------------
# Happy path — the fields the API writes
# ---------------------------------------------------------------------------


def test_parses_voice_test_payload_from_api():
    """Mirrors buildVoiceTestDispatchMetadata's output shape exactly."""
    payload = json.dumps({
        "mode": "voice-test",
        "agentName": "glowbox_sam",
        "session_id": "sess-123",
        "user_identifier": "tester@corp.com",
        "email": "tester@corp.com",
        "instructions": "# Role\nYou are Sam.\n",
        "greeting": "Hi, this is Sam.",
    })

    md = parse_dispatch_metadata(payload)

    assert md.agent_name == "glowbox_sam"
    assert md.session_id == "sess-123"
    assert md.user_identifier == "tester@corp.com"
    assert md.instructions == "# Role\nYou are Sam.\n"
    assert md.greeting == "Hi, this is Sam."


def test_preserves_multiline_instructions():
    """Compiled prompts contain markdown headers + newlines. JSON must
    survive the round-trip without smashing whitespace."""
    prompt = "# Role\n\n## Tools\n- list_products\n- add_to_cart\n"
    payload = json.dumps({
        "mode": "voice-test",
        "agentName": "x",
        "instructions": prompt,
    })

    md = parse_dispatch_metadata(payload)

    assert md.instructions == prompt


# ---------------------------------------------------------------------------
# Fallback path — what the worker does when fields are missing
# ---------------------------------------------------------------------------


def test_missing_instructions_returns_none():
    """A worker dispatched without an injected prompt should not crash —
    it should fall through to its baked-in default. Returning None keeps
    that branch explicit at the call site."""
    md = parse_dispatch_metadata(json.dumps({"agentName": "x"}))

    assert md.instructions is None
    assert md.greeting is None


def test_empty_string_instructions_treated_as_missing():
    """Guard against the API contract drifting to "" instead of omitting.
    Empty system prompt would put the LLM in undefined-behaviour land."""
    md = parse_dispatch_metadata(json.dumps({
        "agentName": "x",
        "instructions": "",
        "greeting": "   ",
    }))

    assert md.instructions is None
    assert md.greeting is None


def test_handles_none_metadata():
    """LiveKit passes None as ``ctx.job.metadata`` for workers dispatched
    without metadata (e.g. ``lk dispatch create`` with no --metadata flag).
    Don't crash; return an empty record so the worker uses its defaults."""
    md = parse_dispatch_metadata(None)

    assert isinstance(md, DispatchMetadata)
    assert md.instructions is None
    assert md.agent_name is None


def test_handles_empty_string_metadata():
    md = parse_dispatch_metadata("")
    assert md.instructions is None


def test_handles_malformed_json_without_crashing():
    """If LiveKit ever delivers garbage, the worker should still come up
    so an operator can inspect the room — not crash before logging."""
    md = parse_dispatch_metadata("{not valid json")

    assert md.instructions is None
    assert md.parse_error is not None


# ---------------------------------------------------------------------------
# Mode dispatch — voice-test vs outbound
# ---------------------------------------------------------------------------


def test_recognises_voice_test_mode():
    md = parse_dispatch_metadata(json.dumps({"mode": "voice-test"}))
    assert md.mode == "voice-test"


def test_recognises_outbound_mode():
    """Outbound calls go through a different dispatch builder but share
    the same parser on the worker side. ``phone_number`` is the
    distinguishing field — the worker uses it to skip greeting playback."""
    payload = json.dumps({
        "mode": "outbound",
        "agentName": "x",
        "phone_number": "+15551234",
    })
    md = parse_dispatch_metadata(payload)

    assert md.mode == "outbound"
    assert md.phone_number == "+15551234"


def test_unknown_mode_still_parses():
    """A forward-compatible mode (e.g. ``test_eval``) shouldn't break
    older workers — they read the fields they care about and ignore the
    rest."""
    md = parse_dispatch_metadata(json.dumps({
        "mode": "test_eval",
        "agentName": "x",
        "instructions": "hi",
    }))

    assert md.mode == "test_eval"
    assert md.instructions == "hi"


# ---------------------------------------------------------------------------
# Defensive parsing — wrong types
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_instructions", [123, [], {}, True])
def test_non_string_instructions_treated_as_missing(bad_instructions):
    """LLM ``instructions`` must be a string. A wrong type means upstream
    is buggy — don't propagate the bug into the runtime by stringifying
    it; treat it as missing and let the worker fall back."""
    payload = json.dumps({"instructions": bad_instructions})
    md = parse_dispatch_metadata(payload)

    assert md.instructions is None
