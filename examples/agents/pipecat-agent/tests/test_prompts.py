"""Tests for the system prompt builder."""

from prompts import SYSTEM_PROMPT_TEMPLATE, build_system_prompt


class TestBuildSystemPrompt:
    def test_interpolates_session_id(self):
        result = build_system_prompt("sess_123")
        assert "sess_123" in result
        assert "{{mg_session_id}}" not in result

    def test_interpolates_user_email(self):
        result = build_system_prompt("sess_1", user_email="alice@example.com")
        assert "alice@example.com" in result
        assert "{{userEmail}}" not in result

    def test_default_user_email(self):
        result = build_system_prompt("sess_1")
        assert "voice-caller" in result

    def test_template_has_no_ssml(self):
        assert "<speak>" not in SYSTEM_PROMPT_TEMPLATE
        assert "<prosody" not in SYSTEM_PROMPT_TEMPLATE
        assert "<break" not in SYSTEM_PROMPT_TEMPLATE

    def test_template_mentions_all_tools(self):
        expected_tools = [
            "list_products",
            "get_product",
            "create_cart",
            "add_to_cart",
            "get_cart",
            "set_delivery_address",
            "complete_cart",
            "get_order",
            "look_up_order_history",
            "send_email",
        ]
        for tool in expected_tools:
            assert tool in SYSTEM_PROMPT_TEMPLATE, f"Missing tool: {tool}"

    def test_prompt_contains_sam_identity(self):
        result = build_system_prompt("sess_1")
        assert "Sam" in result
        assert "BuildPro" in result
