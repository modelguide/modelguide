"""Tests for ``mg_mcp`` — only the pure helpers are unit-testable.

The persistent ``MCPClient`` needs a live HTTP streaming endpoint to
``__aenter__``, so we don't exercise it here — that's covered by the
backend's ``tests/integration/mcp.test.ts``. The URL builder, on the
other hand, is the contract between worker config and the API and IS
worth pinning.
"""

from mg_mcp import MCPTool, build_tool_description, mcp_url_for


def test_mcp_url_builds_from_api_url_and_agent_id():
    """The path shape ``/mcp/{agent_id}`` is the API's contract — if
    routing ever moves to ``/api/mcp/{id}`` or ``/mcp?agent_id=…`` the
    worker would silently fail to call any tool."""
    url = mcp_url_for("https://api.modelguide.test", "agent-uuid")
    assert url == "https://api.modelguide.test/mcp/agent-uuid"


def test_mcp_url_strips_trailing_slash():
    """Operators set MODELGUIDE_API_URL either way — normalize so the
    resulting URL is always single-slashed (some reverse proxies 404
    paths with `//`)."""
    url = mcp_url_for("https://api.modelguide.test/", "agent-uuid")
    assert url == "https://api.modelguide.test/mcp/agent-uuid"


# ---------------------------------------------------------------------------
# build_tool_description
#
# Pinning the format of the LLM-facing tool description matters because:
#   1. The dynamic-wrapper signature is just `arguments: dict`, so the
#      LLM cannot infer parameter names from Python — it has to read the
#      schema from this string.
#   2. If this format ever drifts (e.g. switches to YAML, or drops the
#      schema entirely), the LLM will start calling tools with missing
#      or wrong arg keys and the failures will look like "the model is
#      bad" instead of "we changed the description format".
# ---------------------------------------------------------------------------


def test_description_carries_summary_and_schema():
    tool = MCPTool(
        name="zendesk_create_ticket",
        description="Create a new Zendesk support ticket.",
        input_schema={
            "type": "object",
            "properties": {
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["subject", "body"],
        },
    )
    out = build_tool_description(tool)
    assert "Create a new Zendesk support ticket." in out
    # The full schema must be present (LLM uses it to know which keys
    # to put in the ``arguments`` dict).
    assert '"subject"' in out
    assert '"body"' in out
    assert "Input schema (JSON):" in out


def test_description_handles_missing_summary():
    """If the tool publishes no description at all, the LLM still needs
    the schema — emit just the schema block rather than ``None`` or
    an empty string."""
    tool = MCPTool(
        name="anonymous_tool",
        description="",
        input_schema={"type": "object", "properties": {"x": {"type": "integer"}}},
    )
    out = build_tool_description(tool)
    assert out.startswith("Input schema (JSON):")
    assert '"x"' in out


def test_description_handles_missing_schema():
    """A no-arg tool produces just the human description — no dangling
    'Input schema:' line."""
    tool = MCPTool(
        name="ping",
        description="Check service health.",
        input_schema={},
    )
    out = build_tool_description(tool)
    assert out == "Check service health."
    assert "Input schema" not in out
