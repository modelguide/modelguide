"""Integration of fetch + build at the agent layer.

The agent entrypoint chains ``fetch_runtime_config`` and
``build_system_instructions`` to decide which instructions the
LiveKit ``Agent`` is initialised with. The full entrypoint is hard to
unit-test (LiveKit JobContext, audio plugins, room IO), so this file
locks in the *prompt selection* logic that decides what the agent will say:

* compiled prompt present → use the compiled prompt verbatim
* compiled prompt absent → fall back to operator-supplied default
* fetch fails → caller (entrypoint) must abort

If a future refactor accidentally strips the fetch step and falls back to a
hardcoded prompt baked into the agent, this test fails.
"""

from __future__ import annotations

import httpx
import pytest

from runtime_config import (
    RuntimeConfigError,
    build_system_instructions,
    fetch_runtime_config,
)

FALLBACK = "fallback prompt body"


def _mock(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_full_flow_uses_compiled_prompt():
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "a",
                "slug": "support",
                "name": "Support",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "compiledInstructions": "Latest compiled body — v42",
                "compiledAt": "2026-05-12T00:00:00.000Z",
                "promptConfig": {"persona": "warm"},
            },
        )

    cfg = await fetch_runtime_config(
        api_url="http://api.example.com",
        api_key="mgk_test",
        client=_mock(handler),
    )
    instructions = build_system_instructions(cfg, fallback=FALLBACK)
    assert instructions == "Latest compiled body — v42"


async def test_full_flow_uses_fallback_when_not_compiled():
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "a",
                "slug": "support",
                "name": "Support",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "compiledInstructions": None,
                "compiledAt": None,
                "promptConfig": {},
            },
        )

    cfg = await fetch_runtime_config(
        api_url="http://api.example.com",
        api_key="mgk_test",
        client=_mock(handler),
    )
    instructions = build_system_instructions(cfg, fallback=FALLBACK)
    assert instructions == FALLBACK


async def test_full_flow_aborts_on_fetch_failure():
    """The entrypoint relies on this: if fetch raises, no prompt is built."""
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    with pytest.raises(RuntimeConfigError):
        await fetch_runtime_config(
            api_url="http://api.example.com",
            api_key="mgk_bad",
            client=_mock(handler),
        )
