"""Tests for the browser-test prompt override flow.

When dispatching the agent from the ModelGuide UI for a browser voice
test, the API passes the agent's latest compiled instructions as the
``instructions`` field on the dispatch metadata. The BuildProAgent must
honour the override instead of rebuilding its default prompt, so the
test reflects the prompt the admin is iterating on.
"""

from __future__ import annotations

import pytest

from buildpro import BuildProAgent


class TestInstructionsOverride:
    def test_default_instructions_include_session_and_user(self):
        agent = BuildProAgent(session_id="sess_abc", user_email="alice@test.com")
        assert "sess_abc" in agent._instructions
        assert "alice@test.com" in agent._instructions

    def test_override_replaces_default_instructions(self):
        override = "SYSTEM PROMPT v42 — always say hi."
        agent = BuildProAgent(
            session_id="sess_abc",
            user_email="alice@test.com",
            instructions_override=override,
        )
        assert agent._instructions == override

    def test_override_ignored_when_empty_string(self):
        agent = BuildProAgent(
            session_id="sess_abc",
            user_email="alice@test.com",
            instructions_override="",
        )
        # Empty string is treated as "no override" — fall back to default
        assert "sess_abc" in agent._instructions

    def test_override_ignored_when_none(self):
        agent = BuildProAgent(
            session_id="sess_abc",
            user_email="alice@test.com",
            instructions_override=None,
        )
        assert "sess_abc" in agent._instructions
