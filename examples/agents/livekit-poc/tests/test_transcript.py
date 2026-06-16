"""Tests for the transcript collector.

The transcript is what the dashboard sees after the call ends. We need:

  * User/assistant utterances are recorded in order.
  * Empty/whitespace lines are ignored (LiveKit emits these for partials).
  * ``get_messages()`` returns a JSON-serializable list shaped for
    ``POST /api/sessions/:id/messages``.
"""

from __future__ import annotations

import json

from transcript import TranscriptCollector


class TestUtterances:
    def test_records_user_message(self):
        t = TranscriptCollector()
        t.add_user_utterance("Hello there")
        msgs = t.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Hello there"

    def test_records_assistant_message(self):
        t = TranscriptCollector()
        t.add_assistant_response("Hi! How can I help?")
        msgs = t.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] == "Hi! How can I help?"

    def test_preserves_chronological_order(self):
        t = TranscriptCollector()
        t.add_user_utterance("one")
        t.add_assistant_response("two")
        t.add_user_utterance("three")
        contents = [m["content"] for m in t.get_messages()]
        assert contents == ["one", "two", "three"]

    def test_ignores_empty_string(self):
        # Whisper/Nova-3 sometimes emit `""` on a noise burst between real
        # utterances. Don't pollute the transcript with these.
        t = TranscriptCollector()
        t.add_user_utterance("")
        t.add_assistant_response("   ")
        assert t.get_messages() == []

    def test_strips_whitespace(self):
        t = TranscriptCollector()
        t.add_user_utterance("  hi  ")
        assert t.get_messages()[0]["content"] == "hi"


class TestSerialization:
    def test_messages_are_json_serializable(self):
        t = TranscriptCollector()
        t.add_user_utterance("hello")
        t.add_assistant_response("world")
        # Round-trip through JSON — if anything is a non-serializable type
        # we'd fail to post the transcript to the API.
        assert json.loads(json.dumps(t.get_messages())) == t.get_messages()

    def test_empty_transcript_returns_empty_list(self):
        assert TranscriptCollector().get_messages() == []
