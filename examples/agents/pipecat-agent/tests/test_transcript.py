"""Tests for the TranscriptCollector."""

from transcript import TranscriptCollector


class TestTranscriptCollector:
    def test_empty_collector_returns_empty_list(self):
        tc = TranscriptCollector()
        assert tc.get_messages() == []

    def test_add_user_utterance(self):
        tc = TranscriptCollector()
        tc.add_user_utterance("Hello there")
        msgs = tc.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Hello there"
        assert "occurredAt" in msgs[0]

    def test_add_user_utterance_strips_whitespace(self):
        tc = TranscriptCollector()
        tc.add_user_utterance("  hello  ")
        msgs = tc.get_messages()
        assert msgs[0]["content"] == "hello"

    def test_add_user_utterance_ignores_blank(self):
        tc = TranscriptCollector()
        tc.add_user_utterance("")
        tc.add_user_utterance("   ")
        assert tc.get_messages() == []

    def test_add_assistant_response(self):
        tc = TranscriptCollector()
        tc.add_assistant_response("I can help with that")
        msgs = tc.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] == "I can help with that"

    def test_add_assistant_response_ignores_blank(self):
        tc = TranscriptCollector()
        tc.add_assistant_response("")
        tc.add_assistant_response("  ")
        assert tc.get_messages() == []

    def test_tool_call_flushed_on_get_messages(self):
        tc = TranscriptCollector()
        tc.add_tool_call(
            tool_call_id="tc_1",
            tool_name="list_products",
            tool_input={"query": "drill"},
            tool_output={"products": []},
            latency_ms=150,
            tool_status="success",
        )
        msgs = tc.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert "toolCalls" in msgs[0]
        assert len(msgs[0]["toolCalls"]) == 1
        tc_data = msgs[0]["toolCalls"][0]
        assert tc_data["toolCallId"] == "tc_1"
        assert tc_data["toolName"] == "list_products"
        assert tc_data["toolInput"] == {"query": "drill"}
        assert tc_data["toolOutput"] == {"products": []}
        assert tc_data["latencyMs"] == 150
        assert tc_data["toolStatus"] == "success"

    def test_tool_call_flushed_before_assistant_response(self):
        """Tool calls should appear as a separate message before the next assistant text."""
        tc = TranscriptCollector()
        tc.add_tool_call(
            tool_call_id="tc_1",
            tool_name="get_cart",
            tool_input={},
            tool_output={"items": []},
            latency_ms=80,
        )
        tc.add_assistant_response("Your cart is empty")
        msgs = tc.get_messages()
        assert len(msgs) == 2
        assert "toolCalls" in msgs[0]
        assert msgs[1]["content"] == "Your cart is empty"

    def test_multiple_tool_calls_batched(self):
        """Multiple tool calls without intervening text are batched into one message."""
        tc = TranscriptCollector()
        tc.add_tool_call(
            tool_call_id="tc_1",
            tool_name="list_products",
            tool_input={},
            tool_output={},
            latency_ms=100,
        )
        tc.add_tool_call(
            tool_call_id="tc_2",
            tool_name="get_product",
            tool_input={"product_id": "abc"},
            tool_output={"name": "Concrete Mix"},
            latency_ms=120,
        )
        msgs = tc.get_messages()
        assert len(msgs) == 1
        assert len(msgs[0]["toolCalls"]) == 2

    def test_full_conversation_flow(self):
        """Simulates a realistic conversation with user, tools, and assistant turns."""
        tc = TranscriptCollector()

        tc.add_user_utterance("Do you have concrete mix?")
        tc.add_tool_call(
            tool_call_id="tc_1",
            tool_name="list_products",
            tool_input={"query": "concrete mix"},
            tool_output={"products": [{"name": "QuikCrete 80lb"}]},
            latency_ms=200,
        )
        tc.add_assistant_response("Yes, we have QuikCrete 80lb bags in stock.")
        tc.add_user_utterance("Add one to my cart")
        tc.add_tool_call(
            tool_call_id="tc_2",
            tool_name="add_to_cart",
            tool_input={"product_id": "prod_1", "quantity": 1},
            tool_output={"success": True},
            latency_ms=180,
        )
        tc.add_assistant_response("Added to your cart!")

        msgs = tc.get_messages()
        assert len(msgs) == 6
        assert msgs[0]["role"] == "user"
        assert msgs[1]["role"] == "assistant"  # tool call
        assert "toolCalls" in msgs[1]
        assert msgs[2]["role"] == "assistant"  # text
        assert msgs[2]["content"] == "Yes, we have QuikCrete 80lb bags in stock."
        assert msgs[3]["role"] == "user"
        assert msgs[4]["role"] == "assistant"  # tool call
        assert msgs[5]["role"] == "assistant"  # text

    def test_get_messages_returns_copy(self):
        tc = TranscriptCollector()
        tc.add_user_utterance("hello")
        msgs1 = tc.get_messages()
        msgs2 = tc.get_messages()
        assert msgs1 is not msgs2

    def test_tool_call_error_status(self):
        tc = TranscriptCollector()
        tc.add_tool_call(
            tool_call_id="tc_err",
            tool_name="get_order",
            tool_input={"order_id": "bad"},
            tool_output={"error": "Not found"},
            latency_ms=50,
            tool_status="error",
        )
        msgs = tc.get_messages()
        assert msgs[0]["toolCalls"][0]["toolStatus"] == "error"

    def test_occurred_at_is_iso_format(self):
        tc = TranscriptCollector()
        tc.add_user_utterance("test")
        msg = tc.get_messages()[0]
        # Should be parseable as ISO 8601
        from datetime import datetime
        datetime.fromisoformat(msg["occurredAt"])
