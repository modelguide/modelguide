"""OpenAI function tool definitions and MCP-backed handlers.

The LLM sees short tool names (e.g. `list_products`). Each maps to a
connector-prefixed MCP tool name (e.g. `glowbox_store_list_products`).
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
    "look_up_order_history": "glowbox_store_look_up_order_history",
    "send_email": "glowbox_store_send_email",
}

# ---------------------------------------------------------------------------
# OpenAI function calling schemas
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
                        "description": "Max number of results to return (default: 10)",
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
                    "product_id": {
                        "type": "string",
                        "description": "The product ID",
                    },
                },
                "required": ["product_id"],
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
            "description": "Add a product to the shopping cart.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "string",
                        "description": "Product ID to add",
                    },
                    "variant_id": {
                        "type": "string",
                        "description": "Variant ID (specific size/color)",
                    },
                    "quantity": {
                        "type": "integer",
                        "description": "Number of items to add (default: 1)",
                    },
                },
                "required": ["product_id"],
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
                    "address_1": {"type": "string", "description": "Street address line 1"},
                    "city": {"type": "string", "description": "City"},
                    "province": {"type": "string", "description": "State/province code"},
                    "postal_code": {"type": "string", "description": "Postal/ZIP code"},
                    "country_code": {
                        "type": "string",
                        "description": "Two-letter country code (e.g. 'us')",
                    },
                    "first_name": {"type": "string", "description": "First name"},
                    "last_name": {"type": "string", "description": "Last name"},
                    "phone": {"type": "string", "description": "Phone number"},
                },
                "required": ["address_1", "city", "postal_code", "country_code"],
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
                    "order_id": {"type": "string", "description": "The order ID"},
                },
                "required": ["order_id"],
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

    start = time.monotonic()
    try:
        result = await mg_client.call_tool(mcp_name, tool_args, session_id)
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.info("Tool %s completed in %dms", tool_name, latency_ms)

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
