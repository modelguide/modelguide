"""Transcript collector — append behavior + API payload shape.

The POC reuses ModelGuide's existing ``POST /api/sessions/:id/messages``
endpoint. This file pins the payload shape so a worker-side refactor
can't silently break the dashboard's transcript view.
"""

from transcript import TranscriptCollector, TranscriptMessage


class TestAppend:
    def test_records_user_utterance(self):
        t = TranscriptCollector()
        t.add_user_utterance("Hello")
        assert len(t) == 1
        assert t.messages[0].role == "user"
        assert t.messages[0].content == "Hello"

    def test_records_assistant_response(self):
        t = TranscriptCollector()
        t.add_assistant_response("Hi there")
        assert t.messages[0].role == "assistant"
        assert t.messages[0].content == "Hi there"

    def test_drops_empty_utterances(self):
        # The realtime API sometimes flushes empty deltas at end-of-turn.
        # Don't pollute the transcript with whitespace rows.
        t = TranscriptCollector()
        t.add_user_utterance("")
        t.add_user_utterance("   \n")
        t.add_assistant_response("\t")
        assert len(t) == 0

    def test_preserves_message_order(self):
        t = TranscriptCollector()
        t.add_user_utterance("one")
        t.add_assistant_response("two")
        t.add_user_utterance("three")
        roles = [m.role for m in t.messages]
        assert roles == ["user", "assistant", "user"]


class TestApiPayload:
    def test_shape_matches_modelguide_messages_endpoint(self):
        t = TranscriptCollector()
        t.add_user_utterance("Hi")
        t.add_assistant_response("Hey")

        payload = t.to_api_payload()

        assert len(payload) == 2
        for msg in payload:
            assert set(msg.keys()) == {"role", "content", "timestamp"}
            assert isinstance(msg["timestamp"], int)

    def test_payload_roles_match_messages(self):
        t = TranscriptCollector()
        t.add_user_utterance("a")
        t.add_assistant_response("b")
        payload = t.to_api_payload()
        assert payload[0]["role"] == "user"
        assert payload[1]["role"] == "assistant"


class TestMessageDataclass:
    def test_fields(self):
        m = TranscriptMessage(role="user", content="x", timestamp_ms=123)
        assert m.role == "user"
        assert m.content == "x"
        assert m.timestamp_ms == 123
