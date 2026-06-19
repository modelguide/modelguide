"""Tests for the prototype dispatch metadata parser.

This is the worker-side counterpart of the TypeScript test
``modelguide-api/tests/unit/agents/prototype-voice-test-dispatch.test.ts``.
Both sides MUST stay in lockstep — if the API changes the field names or
shape, this parser will reject the dispatch and the room stays silent
until the client timeout. Failing here in CI is the safety net.
"""

from __future__ import annotations

import json

import pytest

from dispatch import DispatchError, parse_prototype_dispatch


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


VALID_PAYLOAD = {
    "mode": "prototype",
    "agentName": "demo_v1",
    "session_id": "sess-abc",
    "user_identifier": "tester@corp.com",
    "email": "tester@corp.com",
    "instructions": "You are a helpful voice agent.",
}


def test_parses_valid_payload():
    d = parse_prototype_dispatch(json.dumps(VALID_PAYLOAD))
    assert d.mode == "prototype"
    assert d.agent_name == "demo_v1"
    assert d.session_id == "sess-abc"
    assert d.user_identifier == "tester@corp.com"
    assert d.email == "tester@corp.com"
    assert d.instructions == "You are a helpful voice agent."


def test_preserves_instructions_verbatim():
    """Whitespace, newlines, and weird characters must survive the round-trip.

    The API echoes the compiled prompt as-is and so must the worker. Any
    silent ``.strip()`` here would cause a "tested in dashboard, broken
    in deploy" gap because the same prompt would behave differently.
    """
    weird = "  Line 1\n\n  Line 2  \n"
    payload = {**VALID_PAYLOAD, "instructions": weird}
    d = parse_prototype_dispatch(json.dumps(payload))
    assert d.instructions == weird


def test_frozen_dataclass():
    d = parse_prototype_dispatch(json.dumps(VALID_PAYLOAD))
    with pytest.raises(Exception):
        # Mutating PrototypeDispatch should fail — frozen dataclass.
        d.instructions = "tampered"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_rejects_empty_metadata():
    with pytest.raises(DispatchError, match="empty"):
        parse_prototype_dispatch("")


def test_rejects_none_metadata():
    with pytest.raises(DispatchError, match="empty"):
        parse_prototype_dispatch(None)


def test_rejects_invalid_json():
    with pytest.raises(DispatchError, match="not valid JSON"):
        parse_prototype_dispatch("{ not json")


def test_rejects_non_object_payload():
    with pytest.raises(DispatchError, match="must be a JSON object"):
        parse_prototype_dispatch(json.dumps(["a", "b"]))


def test_rejects_wrong_mode():
    """The prototype worker MUST refuse production voice-test dispatches.

    Sharing a worker process between two modes risks the prototype's
    inline-prompt override leaking into production traffic. Each mode gets
    its own worker; rejecting here makes that misconfiguration loud.
    """
    bad = {**VALID_PAYLOAD, "mode": "voice-test"}
    with pytest.raises(DispatchError, match="unexpected dispatch mode"):
        parse_prototype_dispatch(json.dumps(bad))


def test_rejects_missing_instructions():
    bad = {k: v for k, v in VALID_PAYLOAD.items() if k != "instructions"}
    with pytest.raises(DispatchError, match="missing required fields"):
        parse_prototype_dispatch(json.dumps(bad))


def test_rejects_missing_agent_name():
    bad = {k: v for k, v in VALID_PAYLOAD.items() if k != "agentName"}
    with pytest.raises(DispatchError, match="missing required fields"):
        parse_prototype_dispatch(json.dumps(bad))


def test_rejects_blank_instructions():
    bad = {**VALID_PAYLOAD, "instructions": "   \n   "}
    with pytest.raises(DispatchError, match="non-empty string"):
        parse_prototype_dispatch(json.dumps(bad))


def test_rejects_non_string_instructions():
    bad = {**VALID_PAYLOAD, "instructions": 42}
    with pytest.raises(DispatchError, match="non-empty string"):
        parse_prototype_dispatch(json.dumps(bad))
