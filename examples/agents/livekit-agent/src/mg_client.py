"""ModelGuide REST client (sessions) and MCP client (tool execution)."""

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
# Shared HTTP client (one TCP connection pool per agent lifetime)
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    """Lazy-init a shared httpx.AsyncClient for REST calls."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=config.MODELGUIDE_API_URL,
            headers=_headers(),
            timeout=30.0,
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call during shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ---------------------------------------------------------------------------
# Session management (REST)
# ---------------------------------------------------------------------------


async def create_session(user_identifier: str | None = None) -> str:
    """Create a new ModelGuide session. Returns the session ID."""
    client = _get_http_client()
    res = await client.post(
        "/api/sessions",
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
    client = _get_http_client()
    for msg in messages:
        try:
            res = await client.post(
                f"/api/sessions/{session_id}/messages",
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
    client = _get_http_client()
    body: dict = {"status": status}
    if metadata:
        body["metadata"] = metadata
    try:
        res = await client.patch(
            f"/api/sessions/{session_id}",
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
        self._transport_ctx = None
        self._session_ctx = None

    async def connect(self):
        """Open MCP connection and initialize. Call once at pipeline start."""
        url = _mcp_url()
        headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}
        logger.info("MCP connecting to %s", url)
        start = time.monotonic()

        self._transport_ctx = streamablehttp_client(url, headers=headers)
        read, write, _ = await self._transport_ctx.__aenter__()

        self._session_ctx = ClientSession(read, write)
        self._session = await self._session_ctx.__aenter__()
        await self._session.initialize()

        elapsed = int((time.monotonic() - start) * 1000)
        logger.info("MCP connected + initialized in %dms", elapsed)

    async def close(self):
        """Close MCP connection. Call at pipeline end."""
        if self._session_ctx:
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
        result = await self._session.call_tool(tool_name, args_with_session)
        return _parse_mcp_result(result)


def _parse_mcp_result(result) -> dict:
    """Parse MCP result content blocks into a dict."""
    if result.content and len(result.content) > 0:
        block = result.content[0]
        if hasattr(block, "text"):
            try:
                return json.loads(block.text)
            except (json.JSONDecodeError, TypeError):
                return {"result": block.text}
    return {"result": str(result.content)}


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
    """Execute a tool via ModelGuide's MCP endpoint (one-shot, for testing)."""
    args_with_session = {**args, "session_id": session_id}
    headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}

    async with streamablehttp_client(_mcp_url(), headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, args_with_session)
            return _parse_mcp_result(result)
