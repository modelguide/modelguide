"""BuildPro "Sam" voice agent — 11 MCP-backed tools for contractor supply.

To create a different agent scenario:
1. Copy this file and rename the class
2. Update TOOL_NAMES and @function_tool methods
3. Write new prompts (see prompts/base.py and prompts/workflows/)
4. Change the import in agent.py
"""

from __future__ import annotations

import asyncio
import json
import logging

from livekit.agents import RunContext, function_tool

import config
import mg_client
from mcp_agent import MCPAgent
from prompts import build_system_prompt

logger = logging.getLogger("buildpro")

# Tools that need cartId injected automatically
_CART_TOOLS = {"add_to_cart", "get_cart", "set_delivery_address", "complete_cart"}


class BuildProAgent(MCPAgent):
    """BuildPro contractor supply agent with e-commerce tools."""

    TOOL_NAMES = [
        "create_cart", "add_to_cart", "get_cart", "set_delivery_address",
        "complete_cart", "list_products", "get_product", "get_order",
        "look_up_order", "look_up_order_history", "send_email",
    ]

    def __init__(
        self, *, session_id: str | None, user_email: str, mcp: mg_client.MCPConnection | None = None
    ) -> None:
        self._active_cart_id: str | None = None
        self._cart_ready = asyncio.Event()
        self._reorder_product_ids: list[str] = []

        instructions = build_system_prompt(session_id or "", user_email=user_email)
        super().__init__(session_id=session_id, mcp=mcp, instructions=instructions)

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
    # Hooks (BuildPro-specific logic)
    # ------------------------------------------------------------------

    def _check_guardrail(self, tool_name: str, args: dict) -> str | None:
        """Block list_products during reorder — redirect to get_product."""
        if tool_name == "list_products" and self._reorder_product_ids:
            logger.warning(
                "Blocked list_products during reorder — redirecting to get_product "
                "(available product_ids: %s)", self._reorder_product_ids
            )
            return json.dumps({
                "error": "Do not search by name during a reorder. Use get_product instead.",
                "available_product_ids": self._reorder_product_ids,
                "hint": "Call get_product with one of these product_ids from order history.",
            })
        return None

    async def _transform_args(self, tool_name: str, args: dict) -> dict:
        """Inject cartId for cart ops, nest address fields."""
        # Inject cartId for cart operations — wait if create_cart is running in parallel
        if tool_name in _CART_TOOLS:
            if not self._active_cart_id:
                logger.info("Waiting for cart ID (create_cart running in parallel)...")
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

    def _on_tool_result(self, tool_name: str, result: dict) -> None:
        """Extract cart ID and reorder context from tool results."""
        self._extract_cart_id(tool_name, result)
        self._extract_reorder_context(tool_name, result)

    # ------------------------------------------------------------------
    # Result extractors
    # ------------------------------------------------------------------

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
