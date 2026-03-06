"""Tests for tool definitions, name mapping, and handler."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from tools import TOOL_NAME_MAP, TOOL_SCHEMAS, handle_tool_call
from transcript import TranscriptCollector


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
            assert mcp_name.startswith("buildpro_store_"), (
                f"MCP name for {short_name} should start with 'buildpro_store_', got {mcp_name}"
            )

    def test_ten_tools_defined(self):
        assert len(TOOL_SCHEMAS) == 10
        assert len(TOOL_NAME_MAP) == 10

    def test_required_fields_are_lists(self):
        for schema in TOOL_SCHEMAS:
            params = schema["function"]["parameters"]
            assert isinstance(params.get("required", []), list)


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
        # Should record error in transcript
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
        assert tc["latencyMs"] >= 0

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
                tool_name="add_to_cart",
                tool_args={"product_id": "p1", "quantity": 2},
                tool_call_id="tc_4",
                session_id="sess_abc",
                transcript=transcript,
            )

        mock_call.assert_called_once_with(
            "buildpro_store_add_to_cart",
            {"product_id": "p1", "quantity": 2},
            "sess_abc",
        )
