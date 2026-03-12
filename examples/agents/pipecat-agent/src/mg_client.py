"""ModelGuide REST client (sessions) and MCP client (tool execution).

Uses a persistent MCP connection per voice call to avoid reconnect overhead.
"""

import json
import logging
import time

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

import config

logger = logging.getLogger("mg_client")


def _headers():
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.MODELGUIDE_API_KEY}",
    }


def _mcp_url():
    return f"{config.MODELGUIDE_API_URL}/mcp/{config.MODELGUIDE_AGENT_ID}"


# ---------------------------------------------------------------------------
# Session management (REST)
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str | None = None) -> str:
    """Create a new ModelGuide session. Returns the session ID."""
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{config.MODELGUIDE_API_URL}/api/sessions",
            headers=_headers(),
            json={
                "channelType": "voice",
                "userIdentifier": user_identifier or "voice-caller",
            },
        )
        res.raise_for_status()
        data = res.json()
        session_id = data["id"]
        logger.info("Session created: %s", session_id)
        return session_id


async def add_messages(session_id: str, messages: list[dict]) -> None:
    """Post messages to a session. Errors are logged, not raised."""
    async with httpx.AsyncClient() as client:
        for msg in messages:
            try:
                res = await client.post(
                    f"{config.MODELGUIDE_API_URL}/api/sessions/{session_id}/messages",
                    headers=_headers(),
                    json=msg,
                )
                if not res.is_success:
                    logger.warning(
                        "Failed to post message (status %s): %s",
                        res.status_code,
                        res.text,
                    )
            except Exception:
                logger.exception("Error posting message to session %s", session_id)


async def complete_session(
    session_id: str,
    status: str = "completed",
    metadata: dict | None = None,
) -> None:
    """Mark session as completed or abandoned."""
    async with httpx.AsyncClient() as client:
        body: dict = {"status": status}
        if metadata:
            body["metadata"] = metadata
        try:
            res = await client.patch(
                f"{config.MODELGUIDE_API_URL}/api/sessions/{session_id}",
                headers=_headers(),
                json=body,
            )
            if res.is_success:
                logger.info("Session %s completed", session_id)
            else:
                logger.warning(
                    "Failed to complete session %s (status %s): %s",
                    session_id,
                    res.status_code,
                    res.text,
                )
        except Exception:
            logger.exception("Error completing session %s", session_id)


# ---------------------------------------------------------------------------
# Tool execution (MCP) — persistent connection
# ---------------------------------------------------------------------------


class MCPConnection:
    """Persistent MCP connection that stays open for the lifetime of a voice call.

    Usage:
        mcp = MCPConnection()
        await mcp.connect()
        result = await mcp.call_tool("glowbox_store_list_products", {...}, session_id)
        ...
        await mcp.close()
    """

    def __init__(self):
        self._session: ClientSession | None = None
        self._cleanup = None

    async def connect(self):
        """Open MCP connection and initialize. Call once at pipeline start."""
        url = _mcp_url()
        headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}
        logger.info("MCP connecting to %s", url)
        start = time.monotonic()

        # Enter the streamable HTTP context — keep references for cleanup
        self._transport_ctx = streamablehttp_client(url, headers=headers)
        read, write, self._cleanup = await self._transport_ctx.__aenter__()

        # Enter the MCP client session context
        self._session_ctx = ClientSession(read, write)
        self._session = await self._session_ctx.__aenter__()
        await self._session.initialize()

        elapsed = int((time.monotonic() - start) * 1000)
        logger.info("MCP connected + initialized in %dms", elapsed)

    async def close(self):
        """Close MCP connection. Call at pipeline end."""
        if self._session:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception:
                logger.debug("MCP session close error (expected)")
            self._session = None
        if self._transport_ctx:
            try:
                await self._transport_ctx.__aexit__(None, None, None)
            except Exception:
                logger.debug("MCP transport close error (expected)")
            self._transport_ctx = None
        logger.info("MCP connection closed")

    async def call_tool(self, tool_name: str, args: dict, session_id: str) -> dict:
        """Execute a tool on the persistent MCP connection."""
        if not self._session:
            raise RuntimeError("MCP not connected — call connect() first")

        args_with_session = {**args, "session_id": session_id}
        logger.info("MCP call_tool: %s", tool_name)
        start = time.monotonic()

        result = await self._session.call_tool(tool_name, args_with_session)
        elapsed = int((time.monotonic() - start) * 1000)
        logger.info("MCP call_tool %s completed in %dms", tool_name, elapsed)

        if result.content and len(result.content) > 0:
            block = result.content[0]
            if hasattr(block, "text"):
                try:
                    return json.loads(block.text)
                except (json.JSONDecodeError, TypeError):
                    return {"result": block.text}
        return {"result": str(result.content)}


# Keep the one-shot functions for list_tools and non-pipeline use (tests, etc.)

async def list_tools() -> list[dict]:
    """Discover available MCP tools and their schemas. Call at startup to verify."""
    headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}

    async with streamablehttp_client(_mcp_url(), headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            tools = []
            for tool in result.tools:
                tools.append({
                    "name": tool.name,
                    "description": tool.description or "",
                    "inputSchema": tool.inputSchema if hasattr(tool, "inputSchema") else {},
                })
            return tools


async def call_tool(tool_name: str, args: dict, session_id: str) -> dict:
    """One-shot tool call (opens new connection). Use MCPConnection for pipelines."""
    args_with_session = {**args, "session_id": session_id}
    headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}
    url = _mcp_url()
    logger.info("MCP one-shot call_tool: %s → %s", tool_name, url)

    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, args_with_session)
            if result.content and len(result.content) > 0:
                block = result.content[0]
                if hasattr(block, "text"):
                    try:
                        return json.loads(block.text)
                    except (json.JSONDecodeError, TypeError):
                        return {"result": block.text}
            return {"result": str(result.content)}
