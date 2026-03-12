"""End-to-end reorder flow against the real ModelGuide API.

Simulates the full demo conversation step-by-step using direct MCP tool calls,
verifying each response and the full transcript.

Usage:
  cd examples/agents/pipecat-agent
  .venv/bin/python tests/e2e_reorder_flow.py
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import config
import mg_client
from tools import TOOL_NAME_MAP, _transform_args, _extract_cart_id, _active_cart_id
import tools
from transcript import TranscriptCollector

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("e2e")


def pp(label: str, data):
    """Pretty-print a step result."""
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            pass
    print(json.dumps(data, indent=2, default=str) if isinstance(data, (dict, list)) else data)


async def call_tool(tool_name: str, tool_args: dict, session_id: str) -> dict:
    """Call an MCP tool and return parsed result."""
    mcp_name = TOOL_NAME_MAP[tool_name]
    mcp_args = _transform_args(tool_name, {**tool_args})
    result = await mg_client.call_tool(mcp_name, mcp_args, session_id)
    _extract_cart_id(tool_name, result)
    return result


async def main():
    config.validate()
    user_email = config.USER_EMAIL
    tools._active_cart_id = None
    logger.info("User email: %s", user_email)

    # --- Step 1: Create ModelGuide session ---
    session_id = await mg_client.create_session(user_email)
    pp("1. SESSION CREATED", {"session_id": session_id, "user_email": user_email})

    transcript = TranscriptCollector()

    # Simulate user greeting
    transcript.add_user_utterance(
        "Hi, my tile's broken on job and I need to order the same one."
    )

    # --- Step 2: Look up order history ---
    transcript.add_assistant_response("Let me pull up your recent orders.")
    orders = await call_tool("look_up_order_history", {"email": user_email}, session_id)
    pp("2. ORDER HISTORY", orders)

    order_list = orders.get("data", {}).get("orders", [])
    logger.info("Found %d orders", len(order_list))
    for i, order in enumerate(order_list[:3]):
        items = [item["title"] for item in order.get("items", [])]
        addr = order.get("shipping_address", {})
        logger.info("  Order %d: %s → %s", i + 1, ", ".join(items), addr.get("address_1", "no address"))

    # --- Step 3: Get order details (check delivery address) ---
    transcript.add_user_utterance("Which one was delivered to four eight one one Greenway?")

    # Find the order shipped to Greenway
    greenway_order = None
    for order in order_list:
        addr = order.get("shipping_address", {})
        if addr.get("address_1") and "greenway" in addr["address_1"].lower():
            greenway_order = order
            break

    if greenway_order:
        result = await call_tool("get_order", {"orderId": greenway_order["id"]}, session_id)
        pp("3. ORDER DETAIL (Greenway)", result)
        # Verify it's the Dimensions Gris, not Pietra Bernini
        items = [item["title"] for item in greenway_order.get("items", []) if "tile" in item["title"].lower()]
        logger.info("Greenway order tile: %s", items[0] if items else "none found")
    else:
        pp("3. ORDER DETAIL", "No order found with Greenway address")

    # --- Step 4: Search for the tile product (check stock) ---
    transcript.add_assistant_response("January tenth. Checking stock on those now.")
    result = await call_tool("list_products", {"query": "MSI Dimensions Gris"}, session_id)
    pp("4. PRODUCT SEARCH (Dimensions Gris)", result)

    # --- Step 5: Cross-sell — search for Mapei grout ---
    transcript.add_user_utterance("I also need some Mapei grout.")
    transcript.add_assistant_response("Sure, you had the Mapei fifty ninety three last time.")
    result = await call_tool("list_products", {"query": "MAPEI Ultracolor"}, session_id)
    pp("5. PRODUCT SEARCH (Mapei grout)", result)

    # Find grout variant ID from order history
    grout_variant_id = None
    for order in order_list:
        for item in order.get("items", []):
            if "mapei" in item.get("title", "").lower() or "5093" in item.get("title", ""):
                grout_variant_id = item.get("variant_id")
                break
        if grout_variant_id:
            break
    logger.info("Grout variant ID: %s", grout_variant_id)

    # --- Step 6: Create cart + add grout ---
    transcript.add_user_utterance("Yeah, add one more bag.")
    transcript.add_assistant_response("On it.")

    cart = await call_tool("create_cart", {"email": user_email}, session_id)
    pp("6a. CART CREATED", cart)
    logger.info("Active cart ID: %s", tools._active_cart_id)

    if grout_variant_id:
        add_result = await call_tool(
            "add_to_cart", {"variantId": grout_variant_id, "quantity": 1}, session_id
        )
        pp("6b. GROUT ADDED TO CART", add_result)

    cart_contents = await call_tool("get_cart", {}, session_id)
    pp("6c. CART CONTENTS", cart_contents)

    # --- Step 7: Send email ---
    transcript.add_user_utterance("Can you just send it over email and I will come back later?")
    transcript.add_assistant_response("Sure, sending the tile options and grout info now.")

    email_result = await call_tool("send_email", {
        "to": user_email,
        "subject": "BuildPro — Tile Options and Grout for Your Job",
        "body": (
            "Hey Artur,\n\n"
            "Here's what we discussed:\n\n"
            "TILE OPTIONS (MSI Dimensions Gris — 24x48 Matte):\n"
            "- Check availability on preferred size\n\n"
            "GROUT:\n"
            "- Mapei Ultracolor Plus FA #5093 Warm Gray, 25lb — 1 bag in cart\n\n"
            "Your cart is ready when you are. Call back and we'll finish up.\n\n"
            "— Sam, BuildPro"
        ),
    }, session_id)
    pp("7. EMAIL SENT", email_result)

    # --- Step 8: Post transcript + complete session ---
    transcript.add_user_utterance("No, that's all. Thank you.")
    transcript.add_assistant_response("Alright, good luck on the job.")

    messages = transcript.get_messages()
    pp("8a. TRANSCRIPT", {"message_count": len(messages), "messages": messages})

    await mg_client.add_messages(session_id, messages)
    logger.info("Posted %d messages to session %s", len(messages), session_id)

    await mg_client.complete_session(session_id, status="completed")
    pp("8b. SESSION COMPLETED", {"session_id": session_id, "status": "completed"})

    # --- Summary ---
    print(f"\n{'='*70}")
    print(f"  E2E FLOW COMPLETE")
    print(f"{'='*70}")
    print(f"  Session:        {session_id}")
    print(f"  Messages:       {len(messages)}")
    print(f"  Cart ID:        {tools._active_cart_id}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    asyncio.run(main())
