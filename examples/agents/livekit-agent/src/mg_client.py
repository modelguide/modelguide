"""ModelGuide REST client (sessions) and MCP client (tool execution)."""

import json
import logging

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
# Tool execution (MCP)
# ---------------------------------------------------------------------------


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
    """Execute a tool via ModelGuide's MCP endpoint.

    NOTE: Each call opens a new MCP connection and runs initialize(). For
    production use with many tool calls per session, consider holding a
    persistent MCP ClientSession for the lifetime of the voice call.
    """
    args_with_session = {**args, "session_id": session_id}
    headers = {"Authorization": f"Bearer {config.MODELGUIDE_API_KEY}"}

    async with streamablehttp_client(_mcp_url(), headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, args_with_session)
            # MCP result.content is a list of content blocks
            if result.content and len(result.content) > 0:
                block = result.content[0]
                if hasattr(block, "text"):
                    try:
                        return json.loads(block.text)
                    except (json.JSONDecodeError, TypeError):
                        return {"result": block.text}
            return {"result": str(result.content)}
