"""Tests for the BuildProAgent class, tool dispatch, and arg transforms."""

import json
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from agent import BuildProAgent, TOOL_NAME_MAP, _CART_TOOLS
from transcript import TranscriptCollector


def _make_agent(session_id="sess_test", user_email="test@buildpro.com"):
    """Create a BuildProAgent for testing (no LiveKit session needed)."""
    return BuildProAgent(session_id=session_id, user_email=user_email)


class TestToolNameMap:
    def test_eleven_tools_defined(self):
        assert len(TOOL_NAME_MAP) == 11

    def test_all_values_have_connector_prefix(self):
        for short_name, mcp_name in TOOL_NAME_MAP.items():
            assert mcp_name.startswith("glowbox_store_"), (
                f"MCP name for {short_name} should start with 'glowbox_store_', got {mcp_name}"
            )

    def test_cart_tools_are_subset_of_map(self):
        assert _CART_TOOLS.issubset(TOOL_NAME_MAP.keys())


class TestBuildProAgentConstruction:
    def test_creates_with_session_id(self):
        agent = _make_agent(session_id="sess_abc")
        assert agent._session_id == "sess_abc"

    def test_creates_transcript_collector(self):
        agent = _make_agent()
        assert isinstance(agent._transcript, TranscriptCollector)

    def test_initial_cart_id_is_none(self):
        agent = _make_agent()
        assert agent._active_cart_id is None

    def test_instructions_contain_session_id(self):
        agent = _make_agent(session_id="sess_xyz")
        assert "sess_xyz" in agent._instructions

    def test_instructions_contain_user_email(self):
        agent = _make_agent(user_email="alice@test.com")
        assert "alice@test.com" in agent._instructions


class TestToolMethods:
    """Verify all 10 tool methods exist and are callable."""

    def test_all_tool_methods_exist(self):
        agent = _make_agent()
        for short_name in TOOL_NAME_MAP:
            assert hasattr(agent, short_name), f"Missing tool method: {short_name}"


class TestTransformArgs:
    def test_injects_cart_id(self):
        agent = _make_agent()
        agent._active_cart_id = "cart_abc"
        result = agent._transform_args("add_to_cart", {"variantId": "v1", "quantity": 2})
        assert result["cartId"] == "cart_abc"

    def test_no_cart_id_when_none(self):
        agent = _make_agent()
        agent._active_cart_id = None
        result = agent._transform_args("add_to_cart", {"variantId": "v1"})
        assert "cartId" not in result

    def test_no_cart_id_for_non_cart_tools(self):
        agent = _make_agent()
        agent._active_cart_id = "cart_abc"
        result = agent._transform_args("list_products", {"query": "tiles"})
        assert "cartId" not in result

    def test_nests_address_fields(self):
        agent = _make_agent()
        agent._active_cart_id = "cart_abc"
        args = {
            "firstName": "John",
            "lastName": "Smith",
            "address1": "123 Main St",
            "city": "Columbus",
            "postalCode": "43215",
            "countryCode": "us",
        }
        result = agent._transform_args("set_delivery_address", args)
        assert "address" in result
        assert result["address"]["firstName"] == "John"
        assert result["address"]["address1"] == "123 Main St"
        assert result["cartId"] == "cart_abc"
        # Address fields should not be at top level
        assert "firstName" not in result
        assert "address1" not in result

    def test_nests_address_with_phone(self):
        agent = _make_agent()
        agent._active_cart_id = "cart_1"
        args = {
            "address1": "456 Oak Ave",
            "city": "Denver",
            "postalCode": "80202",
            "countryCode": "us",
            "phone": "555-1234",
        }
        result = agent._transform_args("set_delivery_address", args)
        assert result["address"]["phone"] == "555-1234"
        assert "phone" not in result


class TestExtractCartId:
    def test_captures_nested_cart_id(self):
        agent = _make_agent()
        agent._extract_cart_id("create_cart", {"cart": {"id": "cart_xyz"}})
        assert agent._active_cart_id == "cart_xyz"

    def test_captures_data_wrapped_cart_id(self):
        agent = _make_agent()
        agent._extract_cart_id("create_cart", {"data": {"cart": {"id": "cart_wrapped"}}})
        assert agent._active_cart_id == "cart_wrapped"

    def test_captures_flat_cart_id(self):
        agent = _make_agent()
        agent._extract_cart_id("create_cart", {"id": "cart_flat"})
        assert agent._active_cart_id == "cart_flat"

    def test_ignores_non_create_cart(self):
        agent = _make_agent()
        agent._extract_cart_id("list_products", {"id": "not_a_cart"})
        assert agent._active_cart_id is None


class TestCallMcpTool:
    @pytest.mark.asyncio
    async def test_successful_call(self):
        agent = _make_agent(session_id="sess_1")
        mock_result = {"products": [{"name": "Concrete Mix"}]}

        with patch("agent.mg_client.call_tool", new_callable=AsyncMock, return_value=mock_result):
            result = await agent._call_mcp_tool("list_products", {"query": "concrete"})

        parsed = json.loads(result)
        assert parsed == mock_result
        msgs = agent._transcript.get_messages()
        assert len(msgs) == 1
        tc = msgs[0]["toolCalls"][0]
        assert tc["toolName"] == "list_products"
        assert tc["toolStatus"] == "success"

    @pytest.mark.asyncio
    async def test_passes_correct_mcp_name(self):
        agent = _make_agent(session_id="sess_abc")
        mock_call = AsyncMock(return_value={"ok": True})

        with patch("agent.mg_client.call_tool", mock_call):
            await agent._call_mcp_tool("get_order", {"orderId": "order_123"})

        mock_call.assert_called_once_with(
            "glowbox_store_get_order",
            {"orderId": "order_123"},
            "sess_abc",
        )

    @pytest.mark.asyncio
    async def test_mcp_failure_raises_tool_error(self):
        agent = _make_agent()

        with patch(
            "agent.mg_client.call_tool",
            new_callable=AsyncMock,
            side_effect=ConnectionError("MCP server unreachable"),
        ):
            with pytest.raises(Exception, match="Tool list_products failed"):
                await agent._call_mcp_tool("list_products", {"query": "tiles"})

        # Error should still be recorded in transcript
        msgs = agent._transcript.get_messages()
        assert msgs[0]["toolCalls"][0]["toolStatus"] == "error"

    @pytest.mark.asyncio
    async def test_unknown_tool_raises(self):
        agent = _make_agent()

        with pytest.raises(Exception, match="Unknown tool"):
            await agent._call_mcp_tool("nonexistent_tool", {})

    @pytest.mark.asyncio
    async def test_create_cart_captures_cart_id(self):
        agent = _make_agent()
        mock_result = {"cart": {"id": "cart_captured"}}

        with patch("agent.mg_client.call_tool", new_callable=AsyncMock, return_value=mock_result):
            await agent._call_mcp_tool("create_cart", {"email": "test@example.com"})

        assert agent._active_cart_id == "cart_captured"

    @pytest.mark.asyncio
    async def test_cart_id_injected_after_create(self):
        """End-to-end: create_cart captures ID, then add_to_cart uses it."""
        agent = _make_agent()

        with patch("agent.mg_client.call_tool", new_callable=AsyncMock) as mock_call:
            # First call: create_cart returns cart ID
            mock_call.return_value = {"cart": {"id": "cart_e2e"}}
            await agent._call_mcp_tool("create_cart", {"email": "test@example.com"})

            # Second call: add_to_cart should inject the cart ID
            mock_call.return_value = {"success": True}
            await agent._call_mcp_tool("add_to_cart", {"variantId": "v1", "quantity": 2})

            # Verify cartId was injected in the MCP call
            second_call_args = mock_call.call_args_list[1]
            assert second_call_args[0][1]["cartId"] == "cart_e2e"


class TestCamelCaseParams:
    """Verify tool methods use camelCase parameter names."""

    def test_no_snake_case_in_tool_map_keys(self):
        """Tool map keys are intentionally snake_case (internal names)."""
        # This test documents that short names are snake_case by design
        for key in TOOL_NAME_MAP:
            assert "_" in key or key.islower()

    def test_add_to_cart_uses_camel_case(self):
        agent = _make_agent()
        agent._active_cart_id = "cart_1"
        result = agent._transform_args("add_to_cart", {"variantId": "v1", "quantity": 2})
        assert "variantId" in result
        assert "variant_id" not in result

    def test_set_delivery_address_uses_camel_case(self):
        agent = _make_agent()
        result = agent._transform_args("set_delivery_address", {
            "firstName": "John",
            "postalCode": "43215",
            "countryCode": "us",
            "address1": "123 Main",
            "city": "Columbus",
        })
        address = result["address"]
        assert "firstName" in address
        assert "first_name" not in address
        assert "postalCode" in address
        assert "postal_code" not in address
