"""Talk to ModelGuide's MCP endpoint for tool discovery and execution.

The prototype lists tools from MCP at session start and builds matching
LiveKit ``@function_tool`` wrappers on the fly, so the worker doesn't have
to declare them in code (the way ``buildpro.py`` does for the BuildPro
demo). Whatever connectors the operator has wired to this agent in the
dashboard show up automatically the next time a call connects.

Kept tiny on purpose — schema-to-Python coercion is best-effort, since
LiveKit's function-tool decorator infers parameters from Python signatures.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger("mg_mcp")


@dataclass
class MCPTool:
    """A tool discovered via ``ListTools``. ``input_schema`` is a JSON
    Schema dict (per MCP spec); LiveKit's function tool decorator does
    its own argument inference, so we only carry the raw schema for
    debugging / future strict-typing work."""

    name: str
    description: str
    input_schema: dict[str, Any]


def mcp_url_for(api_url: str, agent_id: str) -> str:
    return f"{api_url.rstrip('/')}/mcp/{agent_id}"


def build_tool_description(tool: MCPTool) -> str:
    """LLM-facing description for a dynamically wired tool.

    The LLM doesn't see the JSON Schema directly (LiveKit's function-tool
    decorator infers params from Python signatures, and our dynamic
    wrappers take a single ``dict`` arg). So we embed the schema into
    the description string instead — the LLM uses it to know what keys
    to put in the args object.

    Pure helper so tests can pin the format without spinning up LiveKit.
    """
    base = (tool.description or "").strip()
    if not tool.input_schema:
        return base
    schema = json.dumps(tool.input_schema, separators=(",", ":"))
    if base:
        return f"{base}\n\nInput schema (JSON): {schema}"
    return f"Input schema (JSON): {schema}"


def _parse_call_result(result) -> dict:
    """MCP returns content blocks; the API encodes JSON results into a
    single text block, so unwrap and decode. Falls back to the raw text
    if it isn't JSON (e.g. plaintext errors)."""
    if result.content and len(result.content) > 0:
        block = result.content[0]
        if hasattr(block, "text"):
            try:
                return json.loads(block.text)
            except (json.JSONDecodeError, TypeError):
                return {"result": block.text}
    return {"result": str(result.content)}


class MCPClient:
    """A short-lived persistent MCP connection scoped to one voice session.

    Usage:

        async with MCPClient(api_url, agent_id, api_key) as mcp:
            tools = await mcp.list_tools()
            out = await mcp.call_tool("connector_do_thing", {...}, sess_id)
    """

    def __init__(self, api_url: str, agent_id: str, api_key: str):
        self._url = mcp_url_for(api_url, agent_id)
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._session: ClientSession | None = None
        self._transport_ctx = None
        self._session_ctx = None

    async def __aenter__(self) -> "MCPClient":
        await self._connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def _connect(self) -> None:
        start = time.monotonic()
        self._transport_ctx = streamablehttp_client(self._url, headers=self._headers)
        read, write, _ = await self._transport_ctx.__aenter__()

        self._session_ctx = ClientSession(read, write)
        self._session = await self._session_ctx.__aenter__()
        await self._session.initialize()

        elapsed = int((time.monotonic() - start) * 1000)
        logger.info("MCP connected to %s in %dms", self._url, elapsed)

    async def close(self) -> None:
        if self._session_ctx is not None:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception:
                logger.debug("MCP session close error (expected during shutdown)")
            self._session = None
            self._session_ctx = None
        if self._transport_ctx is not None:
            try:
                await self._transport_ctx.__aexit__(None, None, None)
            except Exception:
                logger.debug("MCP transport close error (expected during shutdown)")
            self._transport_ctx = None

    async def list_tools(self) -> list[MCPTool]:
        if self._session is None:
            raise RuntimeError("MCPClient not entered — use 'async with' first")
        result = await self._session.list_tools()
        tools: list[MCPTool] = []
        for tool in result.tools:
            tools.append(
                MCPTool(
                    name=tool.name,
                    description=tool.description or "",
                    input_schema=getattr(tool, "inputSchema", {}) or {},
                )
            )
        return tools

    async def call_tool(
        self, name: str, args: dict, session_id: str | None
    ) -> dict:
        if self._session is None:
            raise RuntimeError("MCPClient not entered — use 'async with' first")
        # ModelGuide's MCP layer expects session_id alongside the tool args
        # so it can attribute the call to a session_messages row.
        payload = {**args}
        if session_id:
            payload["session_id"] = session_id
        result = await self._session.call_tool(name, payload)
        return _parse_call_result(result)
