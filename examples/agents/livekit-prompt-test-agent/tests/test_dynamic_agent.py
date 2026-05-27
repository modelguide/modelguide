"""Tests for the DynamicAgent class.

DynamicAgent's job is small: it's an ``Agent`` subclass whose
``instructions`` are passed in at construction time (the entrypoint
fetches them from ModelGuide right before, see ``main.py``). The class
itself should:

- accept any string as instructions (don't gate on length, format, etc.)
- expose the bound session_id so the cleanup hook can find it
- own a TranscriptCollector for post-call submission

We don't unit-test the LiveKit session loop itself — that's the
framework's responsibility — but we do guarantee the agent is
constructible without touching the network, which matters because the
worker boot path needs to fail fast on config errors *before* any
remote call happens.
"""

from __future__ import annotations

import pytest

from dynamic_agent import DynamicAgent
from transcript import TranscriptCollector


class TestDynamicAgentConstruction:
    def test_uses_provided_instructions_verbatim(self):
        instructions = "You are an assistant. Be brief."
        agent = DynamicAgent(
            session_id="sess_x", instructions=instructions
        )
        assert agent.instructions == instructions

    def test_accepts_long_instructions(self):
        instructions = "x" * 50_000
        agent = DynamicAgent(
            session_id="sess_x", instructions=instructions
        )
        assert agent.instructions == instructions

    def test_stores_session_id(self):
        agent = DynamicAgent(
            session_id="sess_abc", instructions="prompt"
        )
        assert agent.session_id == "sess_abc"

    def test_allows_null_session_id(self):
        """Session creation can fail upstream — agent still runs without it."""
        agent = DynamicAgent(session_id=None, instructions="prompt")
        assert agent.session_id is None

    def test_provides_fresh_transcript_collector(self):
        agent = DynamicAgent(session_id="s", instructions="prompt")
        assert isinstance(agent.transcript, TranscriptCollector)
        assert agent.transcript.get_messages() == []

    def test_each_instance_has_its_own_transcript(self):
        a1 = DynamicAgent(session_id="s1", instructions="p")
        a2 = DynamicAgent(session_id="s2", instructions="p")
        a1.transcript.add_user_utterance("hi")
        assert a1.transcript.get_messages() != a2.transcript.get_messages()
        assert a2.transcript.get_messages() == []
