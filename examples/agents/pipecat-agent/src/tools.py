"""OpenAI function tool definitions and MCP-backed handlers.

The LLM sees short tool names (e.g. `list_products`). Each maps to a
connector-prefixed MCP tool name (e.g. `glowbox_store_list_products`).

Parameter names match the MCP server's camelCase convention. Cart ID is
tracked automatically — the LLM doesn't need to manage it.
"""

import json
import logging
import time

import mg_client
from transcript import TranscriptCollector

logger = logging.getLogger("tools")

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
    # send_email is stubbed locally (no MCP tool yet)
}

# Tools that need cartId injected automatically
_CART_TOOLS = {"add_to_cart", "get_cart", "set_delivery_address", "complete_cart"}

# ---------------------------------------------------------------------------
# OpenAI function calling schemas (camelCase to match MCP)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "list_products",
            "description": "Search for products in the catalog. Returns product names, prices, and IDs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for products (e.g. 'concrete mix', 'drill bits')",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max number of results to return (default: 20)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_product",
            "description": "Get detailed information about a specific product by ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "productId": {
                        "type": "string",
                        "description": "The product ID",
                    },
                },
                "required": ["productId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_cart",
            "description": "Create a new shopping cart for the customer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "description": "Customer email address",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_cart",
            "description": "Add a product to the shopping cart. Cart ID is managed automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variantId": {
                        "type": "string",
                        "description": "Variant ID (specific size/color) to add",
                    },
                    "quantity": {
                        "type": "integer",
                        "description": "Number of items to add (default: 1)",
                    },
                },
                "required": ["variantId", "quantity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_cart",
            "description": "View the current cart contents and total.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_delivery_address",
            "description": "Set the delivery address for the order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "firstName": {"type": "string", "description": "First name"},
                    "lastName": {"type": "string", "description": "Last name"},
                    "address1": {"type": "string", "description": "Street address line 1"},
                    "city": {"type": "string", "description": "City"},
                    "postalCode": {"type": "string", "description": "Postal/ZIP code"},
                    "countryCode": {
                        "type": "string",
                        "description": "Two-letter country code (e.g. 'us')",
                    },
                    "phone": {"type": "string", "description": "Phone number"},
                },
                "required": ["address1", "city", "postalCode", "countryCode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_cart",
            "description": "Complete the order and place it. Always confirm with the customer first.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_order",
            "description": "Get details of an existing order by order ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "orderId": {"type": "string", "description": "The order ID"},
                },
                "required": ["orderId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "look_up_order",
            "description": "Find a specific order by customer email and order number (e.g. #1042).",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "description": "Customer email address",
                    },
                    "displayId": {
                        "type": "integer",
                        "description": "Order number (e.g. 1042)",
                    },
                },
                "required": ["email", "displayId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "look_up_order_history",
            "description": "Look up a customer's order history by email address.",
            "parameters": {
                "type": "object",
                "properties": {
                    "email": {
                        "type": "string",
                        "description": "Customer email to look up orders for",
                    },
                },
                "required": ["email"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Send an email to the customer (e.g. order confirmation, follow-up).",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address"},
                    "subject": {"type": "string", "description": "Email subject line"},
                    "body": {"type": "string", "description": "Email body (plain text)"},
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


# Cart ID tracked per session (set on create_cart, injected into cart tools)
_active_cart_id: str | None = None


def _transform_args(tool_name: str, args: dict) -> dict:
    """Transform LLM args to match MCP expectations."""
    global _active_cart_id

    # Inject cartId for cart operations
    if tool_name in _CART_TOOLS and _active_cart_id:
        args = {**args, "cartId": _active_cart_id}

    # Nest address fields for set_delivery_address
    if tool_name == "set_delivery_address":
        address_fields = ["firstName", "lastName", "address1", "address2",
                          "city", "postalCode", "countryCode", "phone"]
        address = {k: args.pop(k) for k in address_fields if k in args}
        if address:
            args["address"] = address

    return args


def _extract_cart_id(tool_name: str, result: dict) -> None:
    """Capture cartId from create_cart response."""
    global _active_cart_id
    if tool_name == "create_cart":
        # Medusa returns cart object with id field
        cart_id = result.get("cart", {}).get("id") or result.get("id")
        if cart_id:
            _active_cart_id = cart_id
            logger.info("Cart ID captured: %s", cart_id)


async def handle_tool_call(
    tool_name: str,
    tool_args: dict,
    tool_call_id: str,
    session_id: str,
    transcript: TranscriptCollector,
) -> str:
    """Execute a tool call via MCP and record it in the transcript."""
    mcp_name = TOOL_NAME_MAP.get(tool_name)
    if not mcp_name:
        error = f"Unknown tool: {tool_name}"
        logger.error(error)
        transcript.add_tool_call(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            tool_input=tool_args,
            tool_output={"error": error},
            latency_ms=0,
            tool_status="error",
        )
        return json.dumps({"error": error})

    # Stub: send_email is not yet available as an MCP tool.
    # Return success so the LLM confirms the action to the customer.
    if tool_name == "send_email":
        result = {"success": True, "message": f"Email sent to {tool_args.get('to', 'customer')}"}
        logger.info("send_email stubbed: %s", tool_args.get("subject", ""))
        transcript.add_tool_call(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            tool_input=tool_args,
            tool_output=result,
            latency_ms=0,
            tool_status="success",
        )
        return json.dumps(result)

    # Transform args to match MCP schema
    mcp_args = _transform_args(tool_name, {**tool_args})

    start = time.monotonic()
    try:
        result = await mg_client.call_tool(mcp_name, mcp_args, session_id)
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.info("Tool %s completed in %dms", tool_name, latency_ms)

        # Capture cart ID from create_cart response
        _extract_cart_id(tool_name, result)

        transcript.add_tool_call(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            tool_input=tool_args,
            tool_output=result,
            latency_ms=latency_ms,
            tool_status="success",
        )
        return json.dumps(result)
    except Exception as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.exception("Tool %s failed after %dms", tool_name, latency_ms)
        error_result = {"error": str(e)}
        transcript.add_tool_call(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            tool_input=tool_args,
            tool_output=error_result,
            latency_ms=latency_ms,
            tool_status="error",
        )
        return json.dumps(error_result)
