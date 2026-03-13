"""LiveKit voice agent: BuildPro "Sam" contractor support with ModelGuide MCP tools.

Lifecycle:
  1. On connect:  Create ModelGuide session via REST
  2. During:      LLM tool calls execute via MCP (@function_tool methods)
  3. On close:    Post transcript + complete session

Usage:
  Console:  python src/agent.py console   (text-only, no WebRTC)
  Dev:      python src/agent.py dev       (full WebRTC, LiveKit dev server)
  Start:    python src/agent.py start     (production worker)
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from livekit import agents
from livekit.agents import AgentSession, Agent, RunContext, function_tool, metrics
from livekit.plugins import openai, deepgram, silero
from livekit.plugins.turn_detector.english import EnglishModel

import config
import mg_client
from prompts import build_system_prompt
from transcript import TranscriptCollector

VERSION = "0.2.0"

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("agent")

# ---------------------------------------------------------------------------
# Tool name mapping: LLM short name -> MCP connector tool name
# ---------------------------------------------------------------------------

TOOL_NAME_MAP = {
    "create_cart": "glowbox_store_create_cart",
    "add_to_cart": "glowbox_store_add_to_cart",
    "get_cart": "glowbox_store_get_cart",
    "set_delivery_address": "glowbox_store_set_delivery_address",
    "complete_cart": "glowbox_store_complete_cart",
    "list_products": "glowbox_store_list_products",
    "get_product": "glowbox_store_get_product",
    "get_order": "glowbox_store_get_order",
    "look_up_order": "glowbox_store_look_up_order",
    "look_up_order_history": "glowbox_store_look_up_order_history",
    "send_email": "glowbox_store_send_email",
}

# Tools stubbed locally (no MCP backend yet)
_STUBBED_TOOLS = {"send_email"}

# Tools that need cartId injected automatically
_CART_TOOLS = {"add_to_cart", "get_cart", "set_delivery_address", "complete_cart"}


# ---------------------------------------------------------------------------
# BuildPro Agent
# ---------------------------------------------------------------------------


class BuildProAgent(Agent):
    """BuildPro "Sam" voice agent with 11 MCP-backed tools."""

    def __init__(self, *, session_id: str, user_email: str, mcp: mg_client.MCPConnection | None = None) -> None:
        self._session_id = session_id
        self._transcript = TranscriptCollector()
        self._active_cart_id: str | None = None
        self._mcp = mcp

        instructions = build_system_prompt(session_id, user_email=user_email)
        super().__init__(instructions=instructions)

    # ------------------------------------------------------------------
    # 11 @function_tool methods (camelCase params to match MCP)
    # ------------------------------------------------------------------

    @function_tool()
    async def list_products(self, context: RunContext, query: str = "", limit: int = 20) -> str:
        """Search for products in the catalog. Returns product names, prices, and IDs."""
        return await self._call_mcp_tool("list_products", {"query": query, "limit": limit})

    @function_tool()
    async def get_product(self, context: RunContext, productId: str = "") -> str:
        """Get detailed information about a specific product by ID."""
        return await self._call_mcp_tool("get_product", {"productId": productId})

    @function_tool()
    async def create_cart(self, context: RunContext, email: str = "") -> str:
        """Create a new shopping cart for the customer."""
        return await self._call_mcp_tool("create_cart", {"email": email})

    @function_tool()
    async def add_to_cart(self, context: RunContext, variantId: str = "", quantity: int = 1) -> str:
        """Add a product to the shopping cart. Cart ID is managed automatically."""
        return await self._call_mcp_tool("add_to_cart", {"variantId": variantId, "quantity": quantity})

    @function_tool()
    async def get_cart(self, context: RunContext) -> str:
        """View the current cart contents and total."""
        return await self._call_mcp_tool("get_cart", {})

    @function_tool()
    async def set_delivery_address(
        self,
        context: RunContext,
        firstName: str = "",
        lastName: str = "",
        address1: str = "",
        city: str = "",
        postalCode: str = "",
        countryCode: str = "",
        phone: str = "",
    ) -> str:
        """Set the delivery address for the order."""
        args = {
            k: v
            for k, v in {
                "firstName": firstName,
                "lastName": lastName,
                "address1": address1,
                "city": city,
                "postalCode": postalCode,
                "countryCode": countryCode,
                "phone": phone,
            }.items()
            if v  # only include non-empty values
        }
        return await self._call_mcp_tool("set_delivery_address", args)

    @function_tool()
    async def complete_cart(self, context: RunContext) -> str:
        """Complete the order and place it. Always confirm with the customer first."""
        return await self._call_mcp_tool("complete_cart", {})

    @function_tool()
    async def get_order(self, context: RunContext, orderId: str = "") -> str:
        """Get details of an existing order by order ID."""
        return await self._call_mcp_tool("get_order", {"orderId": orderId})

    @function_tool()
    async def look_up_order_history(self, context: RunContext, email: str = "") -> str:
        """Look up a customer's order history by email address."""
        return await self._call_mcp_tool("look_up_order_history", {"email": email})

    @function_tool()
    async def look_up_order(self, context: RunContext, email: str = "", displayId: str = "") -> str:
        """Look up a specific order by email and display ID (e.g. 'ORD-1234')."""
        return await self._call_mcp_tool("look_up_order", {"email": email, "displayId": displayId})

    @function_tool()
    async def send_email(self, context: RunContext, to: str = "", subject: str = "", body: str = "") -> str:
        """Send an email to the customer (e.g. order confirmation, follow-up)."""
        return await self._call_mcp_tool("send_email", {"to": to, "subject": subject, "body": body})

    # ------------------------------------------------------------------
    # MCP execution core
    # ------------------------------------------------------------------

    async def _call_mcp_tool(self, short_name: str, args: dict) -> str:
        """Execute tool via MCP, with arg transforms and transcript recording."""
        mcp_name = TOOL_NAME_MAP.get(short_name)
        if not mcp_name:
            error = f"Unknown tool: {short_name}"
            logger.error(error)
            raise agents.ToolError(error)

        # Stub tools that have no MCP backend yet
        if short_name in _STUBBED_TOOLS:
            result = {"success": True, "message": f"Email sent to {args.get('to', 'customer')}"}
            logger.info("Tool %s stubbed: %s", short_name, args.get("subject", ""))
            self._transcript.add_tool_call(
                tool_call_id=f"tc_{uuid.uuid4().hex[:8]}",
                tool_name=short_name,
                tool_input=args,
                tool_output=result,
                latency_ms=0,
                tool_status="success",
            )
            return json.dumps(result)

        mcp_args = self._transform_args(short_name, {**args})
        tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"

        start = time.monotonic()
        try:
            if self._mcp:
                result = await self._mcp.call_tool(mcp_name, mcp_args, self._session_id)
            else:
                result = await mg_client.call_tool(mcp_name, mcp_args, self._session_id)
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info("Tool %s completed in %dms", short_name, latency_ms)

            self._extract_cart_id(short_name, result)

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

    def _transform_args(self, tool_name: str, args: dict) -> dict:
        """Transform LLM args to match MCP expectations."""
        # Inject cartId for cart operations
        if tool_name in _CART_TOOLS:
            if self._active_cart_id:
                args["cartId"] = self._active_cart_id
            else:
                logger.warning("No active cart ID for %s — create_cart may not have been called", tool_name)

        # Nest address fields for set_delivery_address
        if tool_name == "set_delivery_address":
            address_fields = [
                "firstName", "lastName", "address1", "address2",
                "city", "postalCode", "countryCode", "phone",
            ]
            address = {k: args.pop(k) for k in address_fields if k in args}
            if address:
                args["address"] = address

        return args

    def _extract_cart_id(self, tool_name: str, result: dict) -> None:
        """Capture cartId from create_cart response."""
        if tool_name == "create_cart":
            # Response shape: {"success": true, "data": {"cart": {"id": "cart_..."}}}
            data = result.get("data", result)
            cart_id = (
                data.get("cart", {}).get("id")
                or data.get("id")
                or result.get("cart", {}).get("id")
                or result.get("id")
            )
            if cart_id:
                self._active_cart_id = cart_id
                logger.info("Cart ID captured: %s", cart_id)


# ---------------------------------------------------------------------------
# TTS factory — switch providers via TTS_PROVIDER env var
# ---------------------------------------------------------------------------


def _create_tts():
    provider = config.TTS_PROVIDER
    logger.info("TTS provider: %s", provider)

    if provider == "cartesia":
        from livekit.plugins import cartesia

        return cartesia.TTS(
            voice=config.CARTESIA_VOICE_ID,
            model="sonic-2",
            api_key=config.CARTESIA_API_KEY,
        )

    # Fallback: ElevenLabs
    from livekit.plugins import elevenlabs

    return elevenlabs.TTS(
        voice_id=config.ELEVENLABS_VOICE_ID,
        model="eleven_flash_v2_5",
        api_key=config.ELEVENLABS_API_KEY,
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info("BuildPro Sam agent v%s — entrypoint called", VERSION)

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    logger.info("Participant joined: %s", participant.identity)

    # Create ModelGuide session + MCP connection in parallel
    async def _init_session():
        try:
            sid = await mg_client.create_session(config.USER_EMAIL)
            logger.info("ModelGuide session: %s", sid)
            return sid
        except Exception:
            logger.exception("Failed to create ModelGuide session — running without tracking")
            return "offline"

    async def _init_mcp():
        conn = mg_client.MCPConnection()
        try:
            await conn.connect()
            return conn
        except Exception:
            logger.exception("Failed to open persistent MCP connection — falling back to one-shot")
            return None

    session_id, mcp = await asyncio.gather(_init_session(), _init_mcp())

    agent = BuildProAgent(session_id=session_id, user_email=config.USER_EMAIL, mcp=mcp)

    tts = _create_tts()

    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            api_key=config.DEEPGRAM_API_KEY,
            interim_results=True,
            endpointing=300,
        ),
        llm=openai.LLM(
            model=config.LLM_MODEL,
            api_key=config.OPENAI_API_KEY,
        ),
        tts=tts,
        vad=silero.VAD.load(),
        turn_detection=EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=0.5,
        min_endpointing_delay=0.3,
    )

    # --- Event handlers ---

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        if ev.is_final:
            agent._transcript.add_user_utterance(ev.transcript)

    @session.on("agent_speech_committed")
    def on_agent_speech(ev):
        agent._transcript.add_assistant_response(ev.content)

    @session.on("metrics_collected")
    def on_metrics(ev):
        metrics.log_metrics(ev)

    async def _cleanup():
        if session_id == "offline":
            return
        try:
            messages = agent._transcript.get_messages()
            status = "completed" if len(messages) > 1 else "abandoned"
            if messages:
                await mg_client.add_messages(session_id, messages)
                logger.info("Posted %d messages to session %s", len(messages), session_id)
            await mg_client.complete_session(session_id, status=status)
        except Exception:
            logger.exception("Failed to post transcript / complete session %s", session_id)
        finally:
            if mcp:
                await mcp.close()

    # Wait for session end, then run cleanup
    session_closed = asyncio.Event()

    @session.on("close")
    def on_close():
        session_closed.set()

    await session.start(
        room=ctx.room,
        agent=agent,
    )

    await session.generate_reply(
        instructions="Greet the user by name and ask what they need."
    )

    # Keep entrypoint alive until session ends + cleanup completes
    await session_closed.wait()
    await _cleanup()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="buildpro-sam",
        )
    )
