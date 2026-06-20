"""Dispatch context — caller identity, session id, and mode from metadata.

Complements ``test_prompt_resolution.py``: the resolver decides what
prompt to use; this module decides who the caller is and which
ModelGuide session to attach the transcript to. The shape of the
metadata blob is shared between both — see
``buildVoiceTestDispatchMetadata`` on the API side.
"""

import json

import pytest

from dispatch_context import DispatchContext, parse_dispatch_context


class TestParseDispatchContext:
    def test_extracts_session_and_user(self):
        md = json.dumps(
            {
                "mode": "voice-test",
                "agentName": "buildpro-sam",
                "session_id": "sess_abc",
                "user_identifier": "ops@example.com",
                "email": "ops@example.com",
            }
        )
        ctx = parse_dispatch_context(md)
        assert ctx.session_id == "sess_abc"
        assert ctx.user_identifier == "ops@example.com"
        assert ctx.agent_name == "buildpro-sam"
        assert ctx.mode == "voice-test"

    def test_missing_metadata_yields_empty_context(self):
        ctx = parse_dispatch_context(None)
        assert ctx.session_id is None
        assert ctx.user_identifier is None
        assert ctx.agent_name is None
        assert ctx.mode is None

    def test_malformed_metadata_yields_empty_context(self):
        ctx = parse_dispatch_context("{not json")
        assert ctx == DispatchContext(
            session_id=None,
            user_identifier=None,
            agent_name=None,
            mode=None,
        )

    def test_non_object_top_level_yields_empty_context(self):
        ctx = parse_dispatch_context("[1, 2, 3]")
        assert ctx.session_id is None

    def test_legacy_user_id_field_is_accepted(self):
        # The dispatch metadata historically used `email`; some callers
        # send `user_identifier`. Accept either, preferring user_identifier
        # because the API contract names it explicitly.
        md = json.dumps({"email": "fallback@example.com"})
        ctx = parse_dispatch_context(md)
        assert ctx.user_identifier == "fallback@example.com"

    def test_user_identifier_wins_over_email(self):
        md = json.dumps(
            {
                "email": "ignored@example.com",
                "user_identifier": "preferred@example.com",
            }
        )
        ctx = parse_dispatch_context(md)
        assert ctx.user_identifier == "preferred@example.com"

    @pytest.mark.parametrize(
        "field",
        ["session_id", "user_identifier", "agent_name", "mode"],
    )
    def test_non_string_field_is_dropped(self, field):
        # Defensive: if a future dispatcher sends a list/dict in one of
        # these fields, drop it rather than propagate garbage to the
        # session-creation REST call.
        md = json.dumps(
            {
                "session_id": "sess_1",
                "user_identifier": "ops@example.com",
                "agentName": "buildpro-sam",
                "mode": "voice-test",
                # Now overwrite the field under test with junk.
                field if field != "agent_name" else "agentName": [1, 2, 3],
            }
        )
        ctx = parse_dispatch_context(md)
        assert getattr(ctx, field) is None
