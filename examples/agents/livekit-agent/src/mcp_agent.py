"""Base class for MCP-backed voice agents.

Handles tool mapping, stub detection, transcript recording, tracing, and
error handling. Subclasses define ``@function_tool`` methods and override
hooks to add scenario-specific logic.

To create a new agent scenario:
1. Subclass ``MCPAgent``
2. Set ``TOOL_NAMES`` to the list of short tool names
3. Define ``@function_tool`` methods that call ``self._call_mcp_tool()``
4. Override hooks as needed (``_transform_args``, ``_on_tool_result``,
   ``_check_guardrail``)
5. Write a new ``prompts/base.py`` for the personality
"""

from __future__ import annotations

import json
import logging
import time
import uuid

from livekit import agents
from livekit.agents import Agent

import config
import mg_client
from tracing import tool_span
from transcript import TranscriptCollector

logger = logging.getLogger("mcp_agent")


def _get_stubbed_tools() -> set[str]:
    """Parse STUBBED_TOOLS from config (comma-separated). Empty string = none stubbed."""
    raw = config.STUBBED_TOOLS
    if not raw or not raw.strip():
        return set()
    return {t.strip() for t in raw.split(",") if t.strip()}


def resolve_instructions(default: str, override: str | None) -> str:
    """Pick the effective system prompt for the agent.

    Returns ``override`` verbatim when it's a non-empty, non-whitespace
    string. Otherwise falls back to the baked profile prompt
    (``default``). Mirrors the API-side guard in
    ``buildVoiceTestDispatchMetadata`` so the two sides agree on what
    counts as "no override" — a whitespace-only override must NOT replace
    the baked prompt with whitespace.
    """
    if isinstance(override, str) and override.strip():
        return override
    return default


class MCPAgent(Agent):
    """Voice agent base class with MCP tool execution, tracing, and transcripts.

    Subclasses must set ``TOOL_NAMES`` and define ``@function_tool`` methods.

    Override these hooks for scenario-specific behavior:
        ``_transform_args``   — modify tool args before MCP call
        ``_on_tool_result``   — extract state from results (e.g. cart ID)
        ``_check_guardrail``  — block or redirect tool calls
    """

    TOOL_NAMES: list[str] = []

    def __init__(
        self,
        *,
        session_id: str | None,
        mcp: mg_client.MCPConnection | None = None,
        instructions: str,
        instructions_override: str | None = None,
    ) -> None:
        self._session_id = session_id
        self._transcript = TranscriptCollector()
        self._mcp = mcp
        self._tool_map = {name: f"{config.CONNECTOR_PREFIX}_{name}" for name in self.TOOL_NAMES}
        effective = resolve_instructions(instructions, instructions_override)
        if effective is not instructions:
            logger.info(
                "Using compiled-prompt override from dispatch metadata "
                "(%d chars, baked default ignored)",
                len(effective),
            )
        super().__init__(instructions=effective)

    # ------------------------------------------------------------------
    # MCP execution core
    # ------------------------------------------------------------------

    async def _call_mcp_tool(self, short_name: str, args: dict) -> str:
        """Execute tool via MCP, with guardrails, stubs, tracing, and transcript."""
        mcp_name = self._tool_map.get(short_name)
        if not mcp_name:
            error = f"Unknown tool: {short_name}"
            logger.error(error)
            raise agents.ToolError(error)

        # Hook: subclass guardrails (e.g. block search during reorder)
        guardrail = self._check_guardrail(short_name, args)
        if guardrail is not None:
            return guardrail

        # Stub tools that have no MCP backend yet
        if short_name in _get_stubbed_tools():
            result = {"success": True, "message": f"{short_name} executed (stubbed)"}
            logger.info("Tool %s stubbed with args: %s", short_name, args)
            self._transcript.add_tool_call(
                tool_call_id=f"tc_{uuid.uuid4().hex[:8]}",
                tool_name=short_name,
                tool_input=args,
                tool_output=result,
                latency_ms=0,
                tool_status="success",
            )
            return json.dumps(result)

        mcp_args = await self._transform_args(short_name, {**args})
        tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"

        start = time.monotonic()
        span_ctx = tool_span(short_name, mcp_name)
        try:
            with span_ctx:
                if self._mcp:
                    result = await self._mcp.call_tool(mcp_name, mcp_args, self._session_id)
                else:
                    result = await mg_client.call_tool(mcp_name, mcp_args, self._session_id)
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info("Tool %s completed in %dms", short_name, latency_ms)

            self._on_tool_result(short_name, result)

            self._transcript.add_tool_call(
                tool_call_id=tool_call_id,
                tool_name=short_name,
                tool_input=args,
                tool_output=result,
                latency_ms=latency_ms,
                tool_status="success",
            )
            return json.dumps(result)
        except Exception as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.exception("Tool %s failed after %dms", short_name, latency_ms)
            error_result = {"error": str(e)}
            self._transcript.add_tool_call(
                tool_call_id=tool_call_id,
                tool_name=short_name,
                tool_input=args,
                tool_output=error_result,
                latency_ms=latency_ms,
                tool_status="error",
            )
            raise agents.ToolError(f"Tool {short_name} failed: {e}") from e

    # ------------------------------------------------------------------
    # Hooks — override in subclasses
    # ------------------------------------------------------------------

    async def _transform_args(self, tool_name: str, args: dict) -> dict:
        """Transform LLM args before sending to MCP. Override for arg injection."""
        return args

    def _on_tool_result(self, tool_name: str, result: dict) -> None:
        """Called after a successful MCP tool call. Override to extract state."""

    def _check_guardrail(self, tool_name: str, args: dict) -> str | None:
        """Check if a tool call should be blocked or redirected.

        Return a JSON string to short-circuit (sent as tool result), or None
        to proceed normally.
        """
        return None
