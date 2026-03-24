"""End-to-end reorder flow against the real ModelGuide API.

Simulates the full conversation from the demo:
  1. Look up order history
  2. Get order details (check delivery address)
  3. Check stock on reorder product
  4. Find alternatives for out-of-stock item
  5. Cross-sell: add grout (Mapei #5093)
  6. Create cart + add grout
  7. Send email with tile options + grout
  8. Complete session

Usage:
  uv run python tests/e2e_reorder_flow.py
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

# Add src/ to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import config
import mg_client
from agent import BuildProAgent

logging.basicConfig(
    level=logging.INFO,
    format="%(name)s | %(levelname)s | %(message)s",
)
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


async def main():
    config.validate()
    user_email = config.USER_EMAIL
    logger.info("User email: %s", user_email)

    # --- Step 1: Create ModelGuide session ---
    session_id = await mg_client.create_session(user_email)
    pp("1. SESSION CREATED", {"session_id": session_id, "user_email": user_email})

    # --- Create agent ---
    agent = BuildProAgent(session_id=session_id, user_email=user_email)
    logger.info("BuildProAgent created with session %s", session_id)

    # Simulate user greeting
    agent._transcript.add_user_utterance(
        "Hi, my tile's broken on job and I need to order the same one."
    )

    # --- Step 2: Look up order history ---
    # Agent: "Let me pull up your recent orders."
    agent._transcript.add_assistant_response("Let me pull up your recent orders.")
    result = await agent._call_mcp_tool("look_up_order_history", {"email": user_email})
    orders = json.loads(result)
    pp("2. ORDER HISTORY", orders)

    # Extract order IDs for next step
    order_list = orders.get("orders", orders.get("data", []))
    if isinstance(order_list, list) and len(order_list) > 0:
        logger.info("Found %d orders", len(order_list))
        for i, order in enumerate(order_list[:3]):
            order_id = order.get("id", order.get("order_id", "unknown"))
            logger.info("  Order %d: %s", i + 1, order_id)
    else:
        logger.warning("No orders found — flow may not match demo exactly")

    # --- Step 3: Get order details (check delivery address) ---
    # User: "Which one was delivered to 4811 Greenway?"
    agent._transcript.add_user_utterance("Which one was delivered to four eight one one Greenway?")

    if isinstance(order_list, list) and len(order_list) >= 2:
        second_order_id = order_list[1].get("id", order_list[1].get("order_id"))
        if second_order_id:
            result = await agent._call_mcp_tool("get_order", {"orderId": second_order_id})
            order_detail = json.loads(result)
            pp("3. ORDER DETAIL (2nd order)", order_detail)
        else:
            pp("3. ORDER DETAIL", "Could not extract order ID")
    else:
        pp("3. ORDER DETAIL", "Not enough orders to check second one")

    # --- Step 4: Search for the tile product (check stock / find alternatives) ---
    # Agent: "Checking stock on those now."
    agent._transcript.add_assistant_response("Checking stock on those now.")
    result = await agent._call_mcp_tool("list_products", {"query": "MSI Dimensions Gris Matte Porcelain Tile"})
    products = json.loads(result)
    pp("4. PRODUCT SEARCH (Dimensions Gris)", products)

    # --- Step 5: Cross-sell — search for Mapei grout ---
    # User: "I need some Mapei grout"
    agent._transcript.add_user_utterance("I also need some Mapei grout.")
    agent._transcript.add_assistant_response(
        "Sure. You used Mapei number fifty ninety three, twenty five pound bags with those tiles. Need more?"
    )
    result = await agent._call_mcp_tool("list_products", {"query": "MAPEI Ultracolor"})
    grout_products = json.loads(result)
    pp("5. PRODUCT SEARCH (Mapei grout)", grout_products)

    # Find a grout variant to add to cart — check search results first,
    # fall back to variant_id from order history
    grout_variant_id = None
    grout_data = grout_products.get("data", grout_products)
    grout_list = grout_data.get("products", []) if isinstance(grout_data, dict) else []
    if isinstance(grout_list, list) and len(grout_list) > 0:
        first_grout = grout_list[0]
        variants = first_grout.get("variants", [])
        if variants:
            grout_variant_id = variants[0].get("id")
        if not grout_variant_id:
            grout_variant_id = first_grout.get("id")

    # Fall back: grab variant ID from the order history (Mapei #5093 was in order 1)
    if not grout_variant_id and isinstance(order_list, list) and len(order_list) > 0:
        for order in order_list:
            for item in order.get("items", []):
                if "mapei" in item.get("title", "").lower() or "5093" in item.get("title", ""):
                    grout_variant_id = item.get("variant_id")
                    logger.info("Grout variant ID from order history: %s", grout_variant_id)
                    break
            if grout_variant_id:
                break

    logger.info("Grout variant ID: %s", grout_variant_id)

    # --- Step 6: Create cart + add grout ---
    # User: "Yeah, add one more bag."
    agent._transcript.add_user_utterance("Yeah, add one more bag.")
    agent._transcript.add_assistant_response("On it. Starting a new cart for you.")

    result = await agent._call_mcp_tool("create_cart", {"email": user_email})
    cart = json.loads(result)
    pp("6a. CART CREATED", cart)
    logger.info("Active cart ID: %s", agent._active_cart_id)

    if grout_variant_id:
        result = await agent._call_mcp_tool(
            "add_to_cart", {"variantId": grout_variant_id, "quantity": 1}
        )
        add_result = json.loads(result)
        pp("6b. GROUT ADDED TO CART", add_result)

    # View cart
    result = await agent._call_mcp_tool("get_cart", {})
    cart_contents = json.loads(result)
    pp("6c. CART CONTENTS", cart_contents)

    # --- Step 7: Send email with tile options + grout ---
    # User: "Can you just send it over email?"
    agent._transcript.add_user_utterance("Can you just send it over email and I will come back later?")
    agent._transcript.add_assistant_response(
        "Sure, will do. Adding the tile options and grout to your email. Anything else for the job?"
    )
    agent._transcript.add_user_utterance("No, that's all. Thank you.")

    result = await agent._call_mcp_tool("send_email", {
        "to": user_email,
        "subject": "BuildPro — Tile Options and Grout for Your Job",
        "body": (
            "Hey Artur,\n\n"
            "Here's what we discussed:\n\n"
            "TILE OPTIONS (MSI Dimensions Gris — 24x48 Matte is out of stock):\n"
            "- MSI Dimensions Gris Matte 24x24 — available\n"
            "- MSI Dimensions Gris Matte 12x24 — available\n\n"
            "GROUT:\n"
            "- Mapei Keracolor U #5093 Warm Gray, 25lb — 1 bag added to cart\n\n"
            "Your cart is ready when you are. Just call back and we'll finish the order.\n\n"
            "— Sam, BuildPro"
        ),
    })
    email_result = json.loads(result)
    pp("7. EMAIL SENT", email_result)

    # --- Step 8: Post transcript + complete session ---
    agent._transcript.add_assistant_response("Alright, good luck on the job.")

    messages = agent._transcript.get_messages()
    pp("8a. TRANSCRIPT", {"message_count": len(messages), "messages": messages})

    await mg_client.add_messages(session_id, messages)
    logger.info("Posted %d messages to session %s", len(messages), session_id)

    await mg_client.complete_session(session_id, status="completed")
    pp("8b. SESSION COMPLETED", {"session_id": session_id, "status": "completed"})

    # --- Summary ---
    tool_calls = [m for m in messages if "toolCalls" in m]
    text_messages = [m for m in messages if "content" in m]
    print(f"\n{'='*70}")
    print(f"  E2E FLOW COMPLETE")
    print(f"{'='*70}")
    print(f"  Session:        {session_id}")
    print(f"  Total messages:  {len(messages)}")
    print(f"  Text messages:   {len(text_messages)}")
    print(f"  Tool calls:      {len(tool_calls)}")
    print(f"  Cart ID:         {agent._active_cart_id}")
    print(f"  Tools executed:  {', '.join(m['toolCalls'][0]['toolName'] for m in tool_calls)}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    asyncio.run(main())
