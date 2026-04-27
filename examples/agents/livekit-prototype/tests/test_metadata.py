"""Tests for `parse_dispatch_metadata` — the prompt-injection contract.

This worker is dispatched by the ModelGuide API's
`POST /api/agents/:id/prototype-voice-test-token` endpoint. The endpoint
JSON-encodes a payload with shape:

    {
      "mode": "voice-test-prototype",
      "agentName": "<agent slug>",
      "instructions": "<compiled system prompt>",
      "session_id": "<modelguide session uuid>",
      "user_identifier": "<caller email>",
      "email": "<caller email>"
    }

`parse_dispatch_metadata` is the single point where this string is decoded
into the values the agent uses. Tests cover happy path, bad JSON, missing
required fields, and whitespace edge cases.
"""

from __future__ import annotations

import json

import pytest

from prototype_agent.metadata import (
    DispatchMetadata,
    InvalidDispatchMetadataError,
    parse_dispatch_metadata,
)


def _payload(**overrides):
    base = {
        "mode": "voice-test-prototype",
        "agentName": "demo_v1",
        "instructions": "You are a helpful agent.",
        "session_id": "00000000-0000-0000-0000-000000000001",
        "user_identifier": "admin@example.com",
        "email": "admin@example.com",
    }
    base.update(overrides)
    return json.dumps(base)


class TestParseDispatchMetadata:
    def test_happy_path_returns_typed_object(self):
        md = parse_dispatch_metadata(_payload())
        assert isinstance(md, DispatchMetadata)
        assert md.agent_name == "demo_v1"
        assert md.instructions == "You are a helpful agent."
        assert md.session_id == "00000000-0000-0000-0000-000000000001"
        assert md.user_identifier == "admin@example.com"

    def test_instructions_are_returned_verbatim(self):
        prompt = "# Role\nYou are an HVAC dispatcher.\n\n# Tone\nBrief."
        md = parse_dispatch_metadata(_payload(instructions=prompt))
        assert md.instructions == prompt

    def test_none_metadata_raises(self):
        with pytest.raises(InvalidDispatchMetadataError):
            parse_dispatch_metadata(None)

    def test_empty_string_raises(self):
        with pytest.raises(InvalidDispatchMetadataError):
            parse_dispatch_metadata("")

    def test_invalid_json_raises(self):
        with pytest.raises(InvalidDispatchMetadataError):
            parse_dispatch_metadata("{not valid json")

    def test_non_object_payload_raises(self):
        # An array or scalar at the top level should be rejected.
        with pytest.raises(InvalidDispatchMetadataError):
            parse_dispatch_metadata("[1, 2, 3]")

    def test_missing_instructions_raises(self):
        payload = json.dumps(
            {
                "mode": "voice-test-prototype",
                "agentName": "demo_v1",
                "session_id": "s",
                "user_identifier": "u",
                "email": "u",
            }
        )
        with pytest.raises(InvalidDispatchMetadataError, match=r"instructions"):
            parse_dispatch_metadata(payload)

    def test_whitespace_only_instructions_raises(self):
        with pytest.raises(InvalidDispatchMetadataError, match=r"instructions"):
            parse_dispatch_metadata(_payload(instructions="   \n\t "))

    def test_missing_agent_name_raises(self):
        payload = json.dumps(
            {
                "mode": "voice-test-prototype",
                "instructions": "x",
                "session_id": "s",
                "user_identifier": "u",
                "email": "u",
            }
        )
        with pytest.raises(InvalidDispatchMetadataError, match=r"agentName"):
            parse_dispatch_metadata(payload)

    def test_user_identifier_falls_back_to_email_when_missing(self):
        # The MG API always sends both, but if a future caller drops
        # `user_identifier` we still want a sane identity.
        payload = json.dumps(
            {
                "mode": "voice-test-prototype",
                "agentName": "demo_v1",
                "instructions": "x",
                "session_id": "s",
                "email": "fallback@example.com",
            }
        )
        md = parse_dispatch_metadata(payload)
        assert md.user_identifier == "fallback@example.com"

    def test_session_id_is_optional_and_defaults_to_none(self):
        # Some smoke-test invocations may want to skip MG session creation.
        payload = json.dumps(
            {
                "mode": "voice-test-prototype",
                "agentName": "demo_v1",
                "instructions": "x",
                "user_identifier": "u@e.com",
                "email": "u@e.com",
            }
        )
        md = parse_dispatch_metadata(payload)
        assert md.session_id is None
