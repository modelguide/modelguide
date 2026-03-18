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
import contextlib
import json
import logging
import time
import uuid

from livekit import agents
from livekit.agents import AgentSession, Agent, RunContext, function_tool
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

def _tool_span(tool_name: str, mcp_name: str):
    """Create an OTel span for a tool call so it shows in Langfuse."""
    if _trace_provider is None:
        return contextlib.nullcontext()
    try:
        tracer = _trace_provider.get_tracer("buildpro-agent")
        return tracer.start_as_current_span(
            f"mcp_tool:{tool_name}",
            attributes={"tool.name": tool_name, "tool.mcp_name": mcp_name},
        )
    except Exception:
        return contextlib.nullcontext()


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
        self._cart_ready = asyncio.Event()  # Set once create_cart captures the ID
        self._mcp = mcp
        # Reorder guardrail: product IDs from order history, set after look_up_order_history
        self._reorder_product_ids: list[str] = []

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

        # Reorder guardrail: block list_products when order history is available
        if short_name == "list_products" and self._reorder_product_ids:
            logger.warning(
                "Blocked list_products during reorder — redirecting to get_product "
                "(available product_ids: %s)", self._reorder_product_ids
            )
            return json.dumps({
                "error": "Do not search by name during a reorder. Use get_product instead.",
                "available_product_ids": self._reorder_product_ids,
                "hint": "Call get_product with one of these product_ids from order history.",
            })

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

        mcp_args = await self._transform_args(short_name, {**args})
        tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"

        start = time.monotonic()
        span_ctx = _tool_span(short_name, mcp_name)
        try:
            with span_ctx:
                if self._mcp:
                    result = await self._mcp.call_tool(mcp_name, mcp_args, self._session_id)
                else:
                    result = await mg_client.call_tool(mcp_name, mcp_args, self._session_id)
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info("Tool %s completed in %dms", short_name, latency_ms)

            self._extract_cart_id(short_name, result)
            self._extract_reorder_context(short_name, result)

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

    async def _transform_args(self, tool_name: str, args: dict) -> dict:
        """Transform LLM args to match MCP expectations."""
        # Inject cartId for cart operations — wait if create_cart is running in parallel
        if tool_name in _CART_TOOLS:
            if not self._active_cart_id:
                logger.info("Waiting for cart ID (create_cart running in parallel)…")
                try:
                    await asyncio.wait_for(self._cart_ready.wait(), timeout=15.0)
                except asyncio.TimeoutError:
                    logger.error("Timed out waiting for cart ID for %s", tool_name)
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
        """Capture cartId from create_cart response and signal waiting tools."""
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
                self._cart_ready.set()
                logger.info("Cart ID captured: %s", cart_id)

    def _extract_reorder_context(self, tool_name: str, result: dict) -> None:
        """Capture product IDs from order history to enforce reorder workflow."""
        if tool_name != "look_up_order_history":
            return
        data = result.get("data", result)
        orders = data.get("orders", [])
        product_ids: list[str] = []
        for order in orders:
            for item in order.get("items", []):
                pid = item.get("product_id")
                if pid and pid not in product_ids:
                    product_ids.append(pid)
        if product_ids:
            self._reorder_product_ids = product_ids
            logger.info("Reorder context: %d product IDs captured", len(product_ids))


# ---------------------------------------------------------------------------
# TTS factory — switch providers via TTS_PROVIDER env var
# ---------------------------------------------------------------------------


def _create_stt():
    model = config.STT_MODEL
    logger.info("STT model: %s", model)

    if model == "flux":
        return deepgram.STTv2(
            model="flux-general-en",
            api_key=config.DEEPGRAM_API_KEY,
            eager_eot_threshold=0.5,
            eot_threshold=0.7,
        )

    # Default: Nova-3
    return deepgram.STT(
        model="nova-3",
        api_key=config.DEEPGRAM_API_KEY,
        interim_results=True,
        endpointing_ms=300,
    )


def _create_tts():
    provider = config.TTS_PROVIDER
    logger.info("TTS provider: %s", provider)

    if provider == "cartesia":
        from livekit.plugins import cartesia

        from livekit.agents import tokenize as _tokenize

        tts = cartesia.TTS(
            voice=config.CARTESIA_VOICE_ID,
            model="sonic-3",
            speed=1.05,
            emotion=["Conversational", "Friendly"],
            api_key=config.CARTESIA_API_KEY,
            tokenizer=_tokenize.blingfire.SentenceTokenizer(
                min_sentence_len=8,
                stream_context_len=5,
            ),
        )
        return tts

    # Fallback: ElevenLabs
    from livekit.plugins import elevenlabs
    from livekit.agents import tokenize

    return elevenlabs.TTS(
        voice_id=config.ELEVENLABS_VOICE_ID,
        model="eleven_flash_v2_5",
        api_key=config.ELEVENLABS_API_KEY,
        inactivity_timeout=30,
        # Emit text to TTS sooner: default min_sentence_len=20 adds ~1s
        # of buffering at slow LLM token rates (5 tokens/s after tool calls)
        word_tokenizer=tokenize.blingfire.SentenceTokenizer(
            min_sentence_len=8,
            stream_context_len=5,
        ),
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


_langfuse_instance = None  # prevent GC
_trace_provider = None     # shared with _tool_span()


def _setup_langfuse(session_metadata: dict | None = None):
    """Configure Langfuse tracing via OpenTelemetry. No-op if keys are not set.

    NOTE: Never pass debug=True to Langfuse() — it adds synchronous logging
    on every span export, causing ~2s+ latency per voice turn.
    """
    global _langfuse_instance, _trace_provider

    if not config.LANGFUSE_PUBLIC_KEY or not config.LANGFUSE_SECRET_KEY:
        logger.info("Langfuse keys not set — tracing disabled")
        return None

    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from livekit.agents.telemetry import set_tracer_provider

    trace_provider = TracerProvider()
    _trace_provider = trace_provider
    set_tracer_provider(trace_provider, metadata=session_metadata)
    _langfuse_instance = Langfuse(
        public_key=config.LANGFUSE_PUBLIC_KEY,
        secret_key=config.LANGFUSE_SECRET_KEY,
        base_url=config.LANGFUSE_HOST,
        tracer_provider=trace_provider,
        should_export_span=lambda span: True,  # Export ALL spans (STT, TTS, LLM, tools)
    )
    logger.info("Langfuse tracing enabled → %s", config.LANGFUSE_HOST)
    return trace_provider


async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entrypoint — called once per room/job."""
    config.validate()
    logger.info("BuildPro Sam agent v%s — entrypoint called", VERSION)

    # Set up Langfuse tracing (opt-in via env vars)
    trace_provider = _setup_langfuse(session_metadata={
        "langfuse.session.id": ctx.room.name,
    })
    if trace_provider:
        async def _flush_traces():
            trace_provider.force_flush()
        ctx.add_shutdown_callback(_flush_traces)

    await ctx.connect()

    # Kick off MG session + MCP connection immediately (don't wait for participant)
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

    # All three run concurrently — participant wait overlaps with network init
    participant, session_id, mcp = await asyncio.gather(
        ctx.wait_for_participant(),
        _init_session(),
        _init_mcp(),
    )
    logger.info("Participant joined: %s", participant.identity)

    agent = BuildProAgent(session_id=session_id, user_email=config.USER_EMAIL, mcp=mcp)

    stt = _create_stt()
    tts = _create_tts()
    use_flux = config.STT_MODEL == "flux"

    session = AgentSession(
        stt=stt,
        llm=openai.LLM(
            model=config.LLM_MODEL,
            api_key=config.OPENAI_API_KEY,
        ),
        tts=tts,
        vad=silero.VAD.load(),
        # Flux handles turn detection internally; Nova-3 needs the English turn detector
        turn_detection="stt" if use_flux else EnglishModel(),
        allow_interruptions=True,
        min_interruption_duration=1.0,
        min_endpointing_delay=0.5,
    )
    # --- Event handlers ---

    # --- Auto-hangup: agent signs off → user says bye → agent replies once → disconnect ---
    _signed_off = False
    _hanging_up = False
    _shutdown_scheduled = False

    @session.on("user_input_transcribed")
    def on_user_speech(ev):
        nonlocal _hanging_up
        if ev.is_final:
            agent._transcript.add_user_utterance(ev.transcript)
            if _signed_off and not _hanging_up:
                text = ev.transcript.strip().lower()
                goodbye_phrases = {"bye", "goodbye", "good bye", "thanks bye",
                                   "thank you bye", "thank you goodbye", "cheers",
                                   "thanks", "thank you", "later", "see ya",
                                   "take care", "have a good one"}
                if any(p in text for p in goodbye_phrases):
                    _hanging_up = True
                    logger.info("User confirmed goodbye — waiting for agent reply then hangup")

    @session.on("conversation_item_added")
    def on_conversation_item(ev):
        nonlocal _signed_off, _shutdown_scheduled
        # ChatMessage with role="assistant" — capture agent responses
        item = ev.item
        if hasattr(item, "role") and item.role == "assistant":
            text = ""
            if hasattr(item, "content") and item.content:
                # content can be a list of ContentPart or a string
                if isinstance(item.content, str):
                    text = item.content
                elif isinstance(item.content, list):
                    text = " ".join(
                        part if isinstance(part, str) else getattr(part, "text", "")
                        for part in item.content
                    )
            if text.strip():
                agent._transcript.add_assistant_response(text.strip())
                lower = text.strip().lower()
                # Detect agent sign-off ("good luck on the job")
                if not _signed_off and ("good luck" in lower or "take care" in lower):
                    _signed_off = True
                    logger.info("Agent signed off — will auto-hangup on user goodbye")
                # Agent replied after user said bye — let TTS play, then disconnect
                elif _hanging_up and not _shutdown_scheduled:
                    _shutdown_scheduled = True
                    logger.info("Agent said final goodbye — shutting down after TTS")

                    async def _hangup_after_speech():
                        # Wait for TTS to finish playing the reply
                        await asyncio.sleep(3.0)
                        session.shutdown()

                    asyncio.create_task(_hangup_after_speech())

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev):
        """Cycle the ElevenLabs TTS WebSocket when agent finishes speaking.

        ElevenLabs degrades TTFB within a single session. Marking the
        connection non-current forces a fresh WebSocket for the next speech.
        """
        if ev.new_state == "listening" and ev.old_state == "speaking":
            try:
                # ElevenLabs: mark connection non-current so next speech
                # gets a fresh WebSocket (old one drains and closes)
                if hasattr(tts, '_current_connection') and tts._current_connection:
                    tts._current_connection.mark_non_current()
                    logger.info("TTS connection cycled (speaking → listening)")
                else:
                    logger.debug("TTS provider has no connection cycling support")
            except Exception as e:
                logger.warning("TTS connection cycling failed: %s", e)

    @session.on("metrics_collected")
    def on_metrics(ev):
        # metrics.log_metrics() has a bug in v1.4.5 (.metadata attr missing)
        # Log key latency metrics manually instead
        try:
            for m in ev.metrics:
                if hasattr(m, "ttft"):
                    logger.info("LLM TTFT: %dms", int(m.ttft * 1000))
                elif hasattr(m, "duration"):
                    logger.info("STT segment: %dms", int(m.duration * 1000))
        except Exception:
            pass

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

    # Wait for session/room end, then run cleanup
    session_done = asyncio.Event()

    @session.on("close")
    def on_session_close():
        logger.info("Session close event fired")
        session_done.set()

    @ctx.room.on("disconnected")
    def on_room_disconnect():
        logger.info("Room disconnected event fired")
        session_done.set()

    await session.start(
        room=ctx.room,
        agent=agent,
    )

    # Direct TTS greeting + prompt cache warm-up run in parallel.
    # The warmup sends the system prompt to OpenAI so subsequent LLM calls
    # hit the prompt cache (~37% faster TTFT, 3x+ token throughput).
    name = participant.name or participant.identity or "there"

    async def _warmup_prompt_cache():
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=config.OPENAI_API_KEY)
            resp = await client.chat.completions.create(
                model=config.LLM_MODEL,
                messages=[{"role": "system", "content": agent.instructions}],
                max_tokens=1,
            )
            logger.info("Prompt cache warmed (%d prompt tokens)", resp.usage.prompt_tokens)
        except Exception:
            logger.debug("Prompt cache warmup failed (non-critical)")

    await asyncio.gather(
        session.say(f"Hey {name} — what do you need?"),
        _warmup_prompt_cache(),
    )

    # Keep entrypoint alive until session/room ends, then always run cleanup
    try:
        await session_done.wait()
    finally:
        logger.info("Running cleanup (messages: %d)", len(agent._transcript.get_messages()))
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
