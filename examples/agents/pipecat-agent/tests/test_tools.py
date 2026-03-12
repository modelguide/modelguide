"""Tests for tool definitions, name mapping, and handler."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from tools import TOOL_NAME_MAP, TOOL_SCHEMAS, handle_tool_call, _transform_args, _extract_cart_id
from transcript import TranscriptCollector
import tools


class TestToolSchemas:
    def test_all_schemas_have_function_type(self):
        for schema in TOOL_SCHEMAS:
            assert schema["type"] == "function"
            assert "name" in schema["function"]
            assert "description" in schema["function"]
            assert "parameters" in schema["function"]

    def test_all_schema_names_are_in_tool_map(self):
        schema_names = {s["function"]["name"] for s in TOOL_SCHEMAS}
        map_names = set(TOOL_NAME_MAP.keys())
        assert schema_names == map_names, (
            f"Mismatch between schemas and map. "
            f"In schemas only: {schema_names - map_names}. "
            f"In map only: {map_names - schema_names}."
        )

    def test_tool_map_values_have_connector_prefix(self):
        for short_name, mcp_name in TOOL_NAME_MAP.items():
            assert mcp_name.startswith("glowbox_store_"), (
                f"MCP name for {short_name} should start with 'glowbox_store_', got {mcp_name}"
            )

    def test_ten_tools_defined(self):
        assert len(TOOL_SCHEMAS) == 10
        assert len(TOOL_NAME_MAP) == 10

    def test_required_fields_are_lists(self):
        for schema in TOOL_SCHEMAS:
            params = schema["function"]["parameters"]
            assert isinstance(params.get("required", []), list)

    def test_camel_case_params(self):
        """All parameter names should be camelCase to match MCP."""
        snake_case_params = []
        for schema in TOOL_SCHEMAS:
            props = schema["function"]["parameters"].get("properties", {})
            for key in props:
                if "_" in key:
                    snake_case_params.append(
                        f"{schema['function']['name']}.{key}"
                    )
        assert snake_case_params == [], (
            f"Found snake_case params (should be camelCase): {snake_case_params}"
        )


class TestTransformArgs:
    def test_injects_cart_id(self):
        tools._active_cart_id = "cart_abc"
        result = _transform_args("add_to_cart", {"variantId": "v1", "quantity": 2})
        assert result["cartId"] == "cart_abc"
        tools._active_cart_id = None

    def test_no_cart_id_for_non_cart_tools(self):
        tools._active_cart_id = "cart_abc"
        result = _transform_args("list_products", {"query": "tiles"})
        assert "cartId" not in result
        tools._active_cart_id = None

    def test_nests_address_fields(self):
        args = {
            "firstName": "John",
            "lastName": "Smith",
            "address1": "123 Main St",
            "city": "Columbus",
            "postalCode": "43215",
            "countryCode": "us",
        }
        tools._active_cart_id = "cart_abc"
        result = _transform_args("set_delivery_address", args)
        assert "address" in result
        assert result["address"]["firstName"] == "John"
        assert result["address"]["address1"] == "123 Main St"
        assert result["cartId"] == "cart_abc"
        # Address fields should not be at top level
        assert "firstName" not in result
        assert "address1" not in result
        tools._active_cart_id = None

    def test_extract_cart_id_from_response(self):
        tools._active_cart_id = None
        _extract_cart_id("create_cart", {"cart": {"id": "cart_xyz"}})
        assert tools._active_cart_id == "cart_xyz"
        tools._active_cart_id = None

    def test_extract_cart_id_flat_response(self):
        tools._active_cart_id = None
        _extract_cart_id("create_cart", {"id": "cart_flat"})
        assert tools._active_cart_id == "cart_flat"
        tools._active_cart_id = None

    def test_ignores_non_create_cart(self):
        tools._active_cart_id = None
        _extract_cart_id("list_products", {"id": "not_a_cart"})
        assert tools._active_cart_id is None


class TestHandleToolCall:
    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        transcript = TranscriptCollector()
        result = await handle_tool_call(
            tool_name="nonexistent_tool",
            tool_args={},
            tool_call_id="tc_1",
            session_id="sess_1",
            transcript=transcript,
        )
        parsed = json.loads(result)
        assert "error" in parsed
        assert "Unknown tool" in parsed["error"]
        msgs = transcript.get_messages()
        assert len(msgs) == 1
        assert msgs[0]["toolCalls"][0]["toolStatus"] == "error"

    @pytest.mark.asyncio
    async def test_successful_tool_call(self):
        transcript = TranscriptCollector()
        mock_result = {"products": [{"name": "Concrete Mix"}]}

        with patch("tools.mg_client.call_tool", new_callable=AsyncMock, return_value=mock_result):
            result = await handle_tool_call(
                tool_name="list_products",
                tool_args={"query": "concrete"},
                tool_call_id="tc_2",
                session_id="sess_1",
                transcript=transcript,
            )

        parsed = json.loads(result)
        assert parsed == mock_result
        msgs = transcript.get_messages()
        assert len(msgs) == 1
        tc = msgs[0]["toolCalls"][0]
        assert tc["toolName"] == "list_products"
        assert tc["toolStatus"] == "success"
        # latencyMs is only included when > 0; mock calls complete instantly
        assert tc.get("latencyMs", 0) >= 0

    @pytest.mark.asyncio
    async def test_tool_call_mcp_failure(self):
        transcript = TranscriptCollector()

        with patch(
            "tools.mg_client.call_tool",
            new_callable=AsyncMock,
            side_effect=ConnectionError("MCP server unreachable"),
        ):
            result = await handle_tool_call(
                tool_name="get_cart",
                tool_args={},
                tool_call_id="tc_3",
                session_id="sess_1",
                transcript=transcript,
            )

        parsed = json.loads(result)
        assert "error" in parsed
        assert "MCP server unreachable" in parsed["error"]
        msgs = transcript.get_messages()
        assert msgs[0]["toolCalls"][0]["toolStatus"] == "error"

    @pytest.mark.asyncio
    async def test_tool_call_passes_correct_mcp_name(self):
        transcript = TranscriptCollector()
        mock_call = AsyncMock(return_value={"ok": True})

        with patch("tools.mg_client.call_tool", mock_call):
            await handle_tool_call(
                tool_name="get_order",
                tool_args={"orderId": "order_123"},
                tool_call_id="tc_4",
                session_id="sess_abc",
                transcript=transcript,
            )

        mock_call.assert_called_once_with(
            "glowbox_store_get_order",
            {"orderId": "order_123"},
            "sess_abc",
        )

    @pytest.mark.asyncio
    async def test_create_cart_captures_cart_id(self):
        tools._active_cart_id = None
        transcript = TranscriptCollector()
        mock_result = {"cart": {"id": "cart_captured"}}

        with patch("tools.mg_client.call_tool", new_callable=AsyncMock, return_value=mock_result):
            await handle_tool_call(
                tool_name="create_cart",
                tool_args={"email": "test@example.com"},
                tool_call_id="tc_5",
                session_id="sess_1",
                transcript=transcript,
            )

        assert tools._active_cart_id == "cart_captured"
        tools._active_cart_id = None
