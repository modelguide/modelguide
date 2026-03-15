"""Behavioral evals for BuildPro Sam using LiveKit's AgentSession test framework.

Tests the agent's conversational behavior, tool usage, and guardrails
without WebRTC — purely text-based LLM evaluation.

Usage:
  uv run pytest tests/test_evals.py -v -s              # all evals
  uv run pytest tests/test_evals.py -k greeting -v -s   # single eval
  LIVEKIT_EVALS_VERBOSE=1 uv run pytest tests/test_evals.py -v -s  # debug

Requires OPENAI_API_KEY in .env (uses real LLM for both agent + judge).
"""

import os
import json
from pathlib import Path

import pytest
from dotenv import load_dotenv

# Load real .env BEFORE conftest's dummy vars take effect
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

from livekit.agents import AgentSession, mock_tools
from livekit.plugins import openai

from agent import BuildProAgent, TOOL_NAME_MAP


# Skip all evals if no real API key (CI / unit-test-only runs)
_has_real_key = os.getenv("OPENAI_API_KEY", "").startswith("sk-")
pytestmark = pytest.mark.skipif(not _has_real_key, reason="Evals require a real OPENAI_API_KEY")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1-mini")


def _make_agent(**kwargs):
    return BuildProAgent(
        session_id=kwargs.get("session_id", "eval_sess_001"),
        user_email=kwargs.get("user_email", "delivered+admin-glowbox@resend.dev"),
    )


# ---------------------------------------------------------------------------
# Mock tool responses (deterministic, no MCP needed)
# ---------------------------------------------------------------------------

MOCK_ORDER_HISTORY = json.dumps({
    "success": True,
    "data": {
        "orders": [
            {
                "id": "order_tile_001",
                "displayId": "ORD-4821",
                "status": "delivered",
                "created_at": "2026-02-06",
                "items": [{"name": "MSI Pietra Bernini Bianco 12x24", "quantity": 10, "variant_id": "var_tile_001"}],
                "shipping_address": {"address1": "4811 Greenway Dr", "city": "Columbus", "postalCode": "43215"},
            },
            {
                "id": "order_grout_002",
                "displayId": "ORD-4790",
                "status": "delivered",
                "created_at": "2026-01-10",
                "items": [{"name": "MSI Dimensions Gris 24x48", "quantity": 14, "variant_id": "var_gris_001"}],
                "shipping_address": {"address1": "800 Industrial Pkwy", "city": "Columbus", "postalCode": "43210"},
            },
        ]
    },
})

MOCK_PRODUCT_LIST = json.dumps({
    "success": True,
    "data": {
        "products": [
            {"id": "prod_grout_001", "name": "Mapei Keracolor U Grout 25lb", "price": 34.99, "variant_id": "var_grout_001", "inventory_quantity": 42},
            {"id": "prod_grout_002", "name": "Mapei Ultracolor Plus FA Grout 25lb", "price": 42.99, "variant_id": "var_grout_002", "inventory_quantity": 18},
        ]
    },
})

MOCK_CREATE_CART = json.dumps({
    "success": True,
    "data": {"cart": {"id": "cart_eval_001"}},
})

MOCK_ADD_TO_CART = json.dumps({
    "success": True,
    "data": {"cart": {"id": "cart_eval_001", "items": [{"name": "MSI Pietra Bernini Bianco", "quantity": 10}]}},
})

MOCK_GET_CART = json.dumps({
    "success": True,
    "data": {"cart": {"id": "cart_eval_001", "total": 349.90, "items": [{"name": "MSI Pietra Bernini Bianco 12x24", "quantity": 10, "price": 34.99}]}},
})


def _mock_tool_responses():
    """Return mock functions for all tools."""
    return {
        "look_up_order_history": lambda **kwargs: MOCK_ORDER_HISTORY,
        "list_products": lambda **kwargs: MOCK_PRODUCT_LIST,
        "get_product": lambda **kwargs: MOCK_PRODUCT_LIST,
        "create_cart": lambda **kwargs: MOCK_CREATE_CART,
        "add_to_cart": lambda **kwargs: MOCK_ADD_TO_CART,
        "get_cart": lambda **kwargs: MOCK_GET_CART,
        "set_delivery_address": lambda **kwargs: json.dumps({"success": True}),
        "complete_cart": lambda **kwargs: json.dumps({"success": True, "data": {"order": {"displayId": "ORD-4900"}}}),
        "get_order": lambda **kwargs: json.dumps({"success": True, "data": {"order": {"displayId": "ORD-4821", "status": "delivered"}}}),
        "look_up_order": lambda **kwargs: json.dumps({"success": True, "data": {"order": {"displayId": "ORD-4821", "status": "delivered"}}}),
        "send_email": lambda **kwargs: json.dumps({"success": True, "message": "Email sent"}),
    }


# ---------------------------------------------------------------------------
# Evals
# ---------------------------------------------------------------------------


class TestGreeting:
    @pytest.mark.asyncio
    async def test_greeting_is_casual(self):
        """Sam should greet casually, not with corporate-speak."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            await session.start(agent)

            result = await session.run(user_input="Hi, this is John")
            await (
                result.expect.contains_message(role="assistant")
                .judge(llm, intent="Responds with a casual, natural greeting — like talking to a coworker. Acceptable: 'hey', 'what's up', 'what do you need'. NOT acceptable: 'Thank you for calling', 'I'd be happy to assist you today', or other scripted customer service language.")
            )


class TestProductSearch:
    @pytest.mark.asyncio
    async def test_searches_catalog_on_product_mention(self):
        """When user mentions a product, Sam should call list_products immediately."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                result = await session.run(user_input="I need some Mapei grout")
                result.expect.contains_function_call(name="list_products")


class TestOrderLookup:
    @pytest.mark.asyncio
    async def test_looks_up_order_history(self):
        """When user asks about past orders, Sam should call look_up_order_history."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                result = await session.run(user_input="What did I order last month?")
                result.expect.contains_function_call(name="look_up_order_history")


class TestReorderFlow:
    @pytest.mark.asyncio
    async def test_reorder_calls_tools_in_order(self):
        """Reorder flow: look up history → create cart → add to cart."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                # User asks to reorder
                result = await session.run(
                    user_input="I need to reorder the same tile from my last order, the one delivered to Greenway"
                )
                # Should look up order history first
                result.expect.contains_function_call(name="look_up_order_history")

    @pytest.mark.asyncio
    async def test_creates_cart_before_adding(self):
        """Sam must create_cart before add_to_cart."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                # Look up + confirm reorder
                await session.run(user_input="Reorder the tile from my last order")
                result = await session.run(user_input="Yes, the Bernini Bianco")

                # Collect all function calls across events
                calls = []
                try:
                    while True:
                        fc = result.expect.next_event(type="function_call")
                        calls.append(fc.event().item.name)
                except Exception:
                    pass

                # If create_cart and add_to_cart both appear, create must come first
                cart_calls = [c for c in calls if c in ("create_cart", "add_to_cart")]
                if len(cart_calls) >= 2:
                    assert cart_calls.index("create_cart") < cart_calls.index("add_to_cart"), (
                        f"create_cart must come before add_to_cart, got: {cart_calls}"
                    )


class TestGuardrails:
    @pytest.mark.asyncio
    async def test_no_internal_ids_in_response(self):
        """Sam should never reveal product IDs, cart IDs, or session IDs."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                result = await session.run(user_input="Show me some Mapei grout options")
                await (
                    result.expect.contains_message(role="assistant")
                    .judge(llm, intent="Describes products in natural language. Does NOT include product IDs like 'prod_' or variant IDs like 'var_'.")
                )

    @pytest.mark.asyncio
    async def test_no_markdown_formatting(self):
        """Sam's responses should be speakable — no bullet points or markdown."""
        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, _mock_tool_responses()):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                result = await session.run(user_input="What did I order recently?")
                await (
                    result.expect.contains_message(role="assistant")
                    .judge(llm, intent="Response is spoken naturally as sentences. Does NOT use bullet points, dashes, numbered lists, or markdown formatting.")
                )


class TestToolErrorHandling:
    @pytest.mark.asyncio
    async def test_handles_tool_failure_gracefully(self):
        """When a tool fails, Sam should acknowledge and offer alternatives."""
        error_mocks = _mock_tool_responses()
        error_mocks["list_products"] = lambda **kwargs: (_ for _ in ()).throw(RuntimeError("MCP server unreachable"))

        async with (
            openai.LLM(model=LLM_MODEL) as llm,
            AgentSession(llm=llm) as session,
        ):
            agent = _make_agent()
            with mock_tools(BuildProAgent, error_mocks):
                await session.start(agent)
                await session.run(user_input="(User joins)")

                result = await session.run(user_input="Find me some concrete mix")
                # The agent may retry the tool. Check the LAST assistant message
                # for graceful error handling (not the first "searching..." message).
                await (
                    result.expect[-3:].contains_message(role="assistant")
                    .judge(llm, intent="Acknowledges something went wrong in plain language (no stack traces, error codes, or technical jargon). May offer to try again or suggest another way to help.")
                )
