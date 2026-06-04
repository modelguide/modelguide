"""Tests for parse_dispatch_metadata — voice-test routing contract.

This is the Python end of the contract that
`buildVoiceTestDispatchMetadata` (modelguide-api/src/features/agents/
agents.service.ts) writes. If the field names drift on either side the
dispatched call goes silent — the test is the type system.
"""

import pytest

from dispatch import DispatchMeta, parse_dispatch_metadata


class TestParseDispatchMetadata:
    def test_voice_test_payload_extracts_session_and_user(self):
        raw = (
            '{"mode":"voice-test","agentName":"sam","session_id":"sess_abc",'
            '"user_identifier":"a@b.com","email":"a@b.com"}'
        )
        m = parse_dispatch_metadata(raw)
        assert isinstance(m, DispatchMeta)
        assert m.mode == "voice-test"
        assert m.agent_slug == "sam"
        assert m.session_id == "sess_abc"
        assert m.user_identifier == "a@b.com"

    def test_empty_metadata_returns_defaults(self):
        m = parse_dispatch_metadata("")
        assert m.mode is None
        assert m.agent_slug is None
        assert m.session_id is None
        # The worker must still boot — never crash on a stale or missing
        # metadata blob.
        assert isinstance(m, DispatchMeta)

    def test_invalid_json_returns_defaults_without_raising(self):
        # The dispatching API is the only producer of this blob, but defence
        # in depth: a malformed payload (e.g. truncated) shouldn't crash the
        # worker before it can even greet the caller.
        m = parse_dispatch_metadata("{not json")
        assert m.mode is None
        assert m.agent_slug is None

    def test_outbound_payload_carries_phone_number(self):
        raw = (
            '{"mode":"outbound","agentName":"sam","session_id":"sess_xyz",'
            '"phone_number":"+15555550100","user_identifier":"+15555550100"}'
        )
        m = parse_dispatch_metadata(raw)
        assert m.mode == "outbound"
        assert m.phone_number == "+15555550100"
        assert m.user_identifier == "+15555550100"
