"""Red→green tests for runtime_config.fetch_runtime_config.

Locks in the contract between the prototype LiveKit agent and the
``GET /api/agents/runtime-config`` endpoint:

* The worker sends Bearer auth using its own API key.
* On 200 it returns a typed config object including the compiled prompt.
* On 401/404 it raises so the worker fails loudly rather than running with
  a stale prompt.
* On null ``compiledInstructions`` it surfaces the fallback so the worker can
  still greet the caller.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

import runtime_config
from runtime_config import (
    RuntimeConfig,
    RuntimeConfigError,
    build_system_instructions,
    fetch_runtime_config,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_transport(handler):
    """Build an httpx AsyncClient whose responses come from `handler`."""
    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Make sure each test starts from a clean module-level HTTP client."""
    asyncio.get_event_loop().run_until_complete(runtime_config.close_http_client())
    yield
    asyncio.get_event_loop().run_until_complete(runtime_config.close_http_client())


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_fetch_returns_typed_config_on_200():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["auth"] = req.headers.get("Authorization")
        return httpx.Response(
            200,
            json={
                "id": "agent-id-1",
                "slug": "support_v1",
                "name": "Support Bot",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "compiledInstructions": "Be helpful and concise.",
                "compiledAt": "2026-05-01T00:00:00.000Z",
                "promptConfig": {"persona": "warm", "language": "en"},
            },
        )

    client = httpx.AsyncClient(transport=_mock_transport(handler))
    config = await fetch_runtime_config(
        api_url="http://api.example.com",
        api_key="mgk_test123",
        client=client,
    )

    assert isinstance(config, RuntimeConfig)
    assert config.id == "agent-id-1"
    assert config.slug == "support_v1"
    assert config.compiled_instructions == "Be helpful and concise."
    assert config.compiled_at == "2026-05-01T00:00:00.000Z"
    assert config.prompt_config == {"persona": "warm", "language": "en"}

    # Calls the documented path with Bearer auth.
    assert captured["url"].endswith("/api/agents/runtime-config")
    assert captured["auth"] == "Bearer mgk_test123"


async def test_fetch_strips_trailing_slash_from_base_url():
    """``MODELGUIDE_API_URL`` is allowed to end with a slash — must not
    produce ``//api/agents/runtime-config`` which some gateways reject."""
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(
            200,
            json={
                "id": "x",
                "slug": "x",
                "name": "x",
                "modality": "voice",
                "modelFamily": "generic",
                "agentPlatform": "livekit",
                "compiledInstructions": "x",
                "compiledAt": None,
                "promptConfig": {},
            },
        )

    client = httpx.AsyncClient(transport=_mock_transport(handler))
    await fetch_runtime_config(
        api_url="http://api.example.com/",  # note trailing slash
        api_key="mgk_x",
        client=client,
    )
    assert "//api/agents" not in captured["url"]


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [401, 403, 404, 500])
async def test_fetch_raises_on_non_2xx(status: int):
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": "nope"})

    client = httpx.AsyncClient(transport=_mock_transport(handler))
    with pytest.raises(RuntimeConfigError):
        await fetch_runtime_config(
            api_url="http://api.example.com",
            api_key="mgk_x",
            client=client,
        )


async def test_fetch_raises_on_network_error():
    def handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope")

    client = httpx.AsyncClient(transport=_mock_transport(handler))
    with pytest.raises(RuntimeConfigError):
        await fetch_runtime_config(
            api_url="http://api.example.com",
            api_key="mgk_x",
            client=client,
        )


# ---------------------------------------------------------------------------
# build_system_instructions — fallback handling
# ---------------------------------------------------------------------------


def _config(compiled: str | None) -> RuntimeConfig:
    return RuntimeConfig(
        id="x",
        slug="x",
        name="x",
        modality="voice",
        model_family="generic",
        agent_platform="livekit",
        compiled_instructions=compiled,
        compiled_at=None,
        prompt_config={},
    )


def test_build_system_instructions_uses_compiled_prompt():
    instructions = build_system_instructions(_config("Compiled prompt body"), fallback="FB")
    assert instructions == "Compiled prompt body"


def test_build_system_instructions_falls_back_when_compiled_is_none():
    instructions = build_system_instructions(_config(None), fallback="FB body")
    assert instructions == "FB body"


def test_build_system_instructions_falls_back_when_compiled_is_empty():
    """An empty string is treated as "not compiled" — the operator likely
    wiped the prompt but didn't intend the agent to run silent."""
    instructions = build_system_instructions(_config(""), fallback="FB body")
    assert instructions == "FB body"


def test_build_system_instructions_raises_when_neither_available():
    """Worker should fail loudly rather than start with a blank system prompt
    (which would produce wildly off-script behaviour)."""
    with pytest.raises(RuntimeConfigError):
        build_system_instructions(_config(None), fallback="")
