"""Tests for the system prompt builder."""

from prompts import SYSTEM_PROMPT_TEMPLATE, build_system_prompt
from prompts.workflows import load_all


class TestBuildSystemPrompt:
    def test_interpolates_session_id(self):
        result = build_system_prompt("sess_123")
        assert "sess_123" in result
        assert "{{mg_session_id}}" not in result

    def test_interpolates_user_email(self):
        result = build_system_prompt("sess_1", user_email="alice@example.com")
        assert "alice@example.com" in result
        assert "{{userEmail}}" not in result

    def test_interpolates_channel(self):
        result = build_system_prompt("sess_1", channel="text")
        assert "text" in result
        assert "{{channel}}" not in result

    def test_interpolates_order_id(self):
        result = build_system_prompt("sess_1", order_id="ORD-123")
        assert "ORD-123" in result
        assert "{{orderId}}" not in result

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

    def test_prompt_contains_guardrails(self):
        assert "Guardrails" in SYSTEM_PROMPT_TEMPLATE
        assert "Never make up prices" in SYSTEM_PROMPT_TEMPLATE
        assert "Never reveal internal identifiers" in SYSTEM_PROMPT_TEMPLATE

    def test_prompt_contains_voice_output_rules(self):
        assert "Voice output rules" in SYSTEM_PROMPT_TEMPLATE
        assert "two forty nine dollars" in SYSTEM_PROMPT_TEMPLATE


class TestTemplateOverride:
    """ADR-015 — prompts/get_runtime_config() flow."""

    def test_uses_override_template_when_provided(self):
        result = build_system_prompt(
            "sess_1",
            user_email="bob@x.com",
            template="Custom: {{userEmail}} / {{mg_session_id}}",
        )
        assert result == "Custom: bob@x.com / sess_1"
        # Critically: no leakage from the baked-in BuildPro template
        assert "BuildPro" not in result
        assert "Sam" not in result

    def test_falls_back_to_baked_in_when_template_is_none(self):
        result = build_system_prompt("sess_1", template=None)
        assert "BuildPro" in result
        assert "Sam" in result

    def test_falls_back_to_baked_in_by_default(self):
        # No template arg at all — same as None
        result = build_system_prompt("sess_1")
        assert "BuildPro" in result

    def test_override_still_interpolates_all_placeholders(self):
        template = "S:{{mg_session_id}} U:{{userEmail}} C:{{channel}} O:{{orderId}}"
        result = build_system_prompt(
            "sess_x",
            user_email="alice@y.com",
            channel="text",
            order_id="ORD-9",
            template=template,
        )
        assert result == "S:sess_x U:alice@y.com C:text O:ORD-9"

    def test_empty_string_override_is_respected(self):
        # Edge case: caller explicitly passes "" — that's a valid (empty) prompt,
        # not a "fall back to baked-in" signal. The is-not-None check matters.
        result = build_system_prompt("sess_1", template="")
        assert result == ""


class TestWorkflowLoading:
    def test_loads_all_workflows(self):
        workflows = load_all()
        assert len(workflows) == 7

    def test_all_workflows_included_in_template(self):
        assert "Ordering workflow" in SYSTEM_PROMPT_TEMPLATE
        assert "reorder workflow" in SYSTEM_PROMPT_TEMPLATE
        assert "Out-of-stock workflow" in SYSTEM_PROMPT_TEMPLATE
        assert "Email workflow" in SYSTEM_PROMPT_TEMPLATE
        assert "WISMO" in SYSTEM_PROMPT_TEMPLATE
        assert "Product search workflow" in SYSTEM_PROMPT_TEMPLATE
        assert "Cross-sell" in SYSTEM_PROMPT_TEMPLATE

    def test_each_workflow_has_content(self):
        workflows = load_all()
        for wf in workflows:
            assert len(wf) > 50, "Workflow prompt seems too short"
