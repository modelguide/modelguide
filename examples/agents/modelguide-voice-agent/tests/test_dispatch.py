"""Tests for dispatch-metadata parsing.

The ModelGuide API includes ``agentId`` and ``agentName`` in the JSON
metadata it attaches to each LiveKit dispatch (see
``modelguide-api/src/features/agents/agents.service.ts:buildVoiceTestDispatchMetadata``).

We treat that contract as load-bearing: if the worker can't pull
``agentId`` out of the dispatch payload, every voice-test call ends up
running against the wrong (or no) compiled prompt and the user thinks
"Compile" did nothing. So lock it in here.
"""

import json

import pytest

from dispatch import parse_dispatch_metadata


class TestParseDispatchMetadata:
    def test_extracts_agent_id_and_slug(self):
        raw = json.dumps(
            {
                "mode": "voice-test",
                "agentId": "11111111-2222-3333-4444-555555555555",
                "agentName": "glowbox-voice",
                "session_id": "sess-abc",
                "user_identifier": "tester@corp.com",
                "email": "tester@corp.com",
            }
        )
        md = parse_dispatch_metadata(raw)
        assert md.agent_id == "11111111-2222-3333-4444-555555555555"
        assert md.agent_slug == "glowbox-voice"
        assert md.session_id == "sess-abc"
        assert md.caller_email == "tester@corp.com"

    def test_returns_none_for_empty_metadata(self):
        # SIP / dev-room dispatches arrive without any metadata. The agent
        # should fall back to env-config rather than crashing the worker.
        assert parse_dispatch_metadata(None) is None
        assert parse_dispatch_metadata("") is None

    def test_returns_none_for_invalid_json(self):
        # Invalid metadata isn't worth blowing up over — log and run with
        # env-config defaults so a human can still reach the agent.
        assert parse_dispatch_metadata("not-json") is None

    def test_missing_agent_id_yields_partial_object(self):
        # Older outbound dispatches don't carry agentId. The worker should
        # still parse what's there and degrade to env-config for the prompt.
        raw = json.dumps({"agentName": "old-style", "session_id": "s"})
        md = parse_dispatch_metadata(raw)
        assert md is not None
        assert md.agent_id is None
        assert md.agent_slug == "old-style"
