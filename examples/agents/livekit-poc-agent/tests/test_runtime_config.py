"""Red-green TDD tests for ``runtime_config.fetch``.

The POC LiveKit agent fetches its system prompt from ModelGuide on every
session start so the dashboard's "Compile" button has an immediate effect
on the next call (no worker redeploy). That contract is what these tests
pin down — see ADR-015 and the README in this folder.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from livekit_poc_agent import runtime_config


def _resp(status: int = 200, json_data: dict | None = None, text: str = ""):
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.is_success = 200 <= status < 300
    r.json.return_value = json_data or {}
    r.text = text
    if status >= 400:
        r.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("err", request=MagicMock(), response=r)
        )
    else:
        r.raise_for_status = MagicMock()
    return r


def _client(response):
    c = AsyncMock()
    c.get.return_value = response
    c.aclose = AsyncMock()
    return c


@pytest.mark.asyncio
async def test_fetch_returns_runtime_config_dataclass():
    """Happy path — GET /api/agents/me/runtime-config → RuntimeConfig."""
    client = _client(
        _resp(
            200,
            {
                "id": "00000000-0000-0000-0000-000000000abc",
                "name": "Demo Voice Agent",
                "slug": "demo-voice",
                "modality": "voice",
                "agentPlatform": "livekit",
                "modelFamily": "gpt",
                "isActive": True,
                "compiledInstructions": "You are Demo. Greet the caller.",
                "compiledAt": "2026-04-01T00:00:00.000Z",
                "promptConfig": {"persona": "warm"},
                "metadata": {"livekit": {"agentName": "demo-voice"}},
            },
        )
    )
    with patch("livekit_poc_agent.runtime_config.httpx.AsyncClient", return_value=client):
        cfg = await runtime_config.fetch(
            base_url="http://localhost:3000", api_key="mgk_test"
        )

    assert cfg.id == "00000000-0000-0000-0000-000000000abc"
    assert cfg.name == "Demo Voice Agent"
    assert cfg.slug == "demo-voice"
    assert cfg.compiled_instructions == "You are Demo. Greet the caller."
    assert cfg.compiled_at == "2026-04-01T00:00:00.000Z"
    assert cfg.is_active is True
    assert cfg.modality == "voice"


@pytest.mark.asyncio
async def test_fetch_sends_bearer_authorization_header():
    """Correct auth header — without it the API returns 401."""
    client = _client(_resp(200, {"id": "x", "name": "n", "slug": "s",
                                 "modality": "voice", "agentPlatform": "livekit",
                                 "modelFamily": "gpt", "isActive": True,
                                 "compiledInstructions": None, "compiledAt": None,
                                 "promptConfig": {}, "metadata": {}}))
    with patch(
        "livekit_poc_agent.runtime_config.httpx.AsyncClient", return_value=client
    ) as ctor:
        await runtime_config.fetch(base_url="http://x", api_key="mgk_secret")
        # httpx.AsyncClient(headers=...) — kwarg forwarded to the constructor
        ctor_kwargs = ctor.call_args[1]

    assert ctor_kwargs["headers"]["Authorization"] == "Bearer mgk_secret"
    # Path is the runtime-config route, not the user-scoped /api/agents/{id}
    assert client.get.call_args[0][0] == "/api/agents/me/runtime-config"


@pytest.mark.asyncio
async def test_fetch_strips_trailing_slash_from_base_url():
    """A common .env mistake — must not produce //api/agents/me/runtime-config."""
    client = _client(_resp(200, {"id": "x", "name": "n", "slug": "s",
                                 "modality": "voice", "agentPlatform": "livekit",
                                 "modelFamily": "gpt", "isActive": True,
                                 "compiledInstructions": None, "compiledAt": None,
                                 "promptConfig": {}, "metadata": {}}))
    with patch(
        "livekit_poc_agent.runtime_config.httpx.AsyncClient", return_value=client
    ) as ctor:
        await runtime_config.fetch(base_url="http://localhost:3000/", api_key="mgk_x")
        ctor_kwargs = ctor.call_args[1]

    assert ctor_kwargs["base_url"] == "http://localhost:3000"


@pytest.mark.asyncio
async def test_fetch_handles_null_compiled_prompt():
    """When the agent has not been compiled yet, compiled_instructions is None."""
    client = _client(_resp(200, {"id": "x", "name": "n", "slug": "s",
                                 "modality": "voice", "agentPlatform": "livekit",
                                 "modelFamily": "gpt", "isActive": True,
                                 "compiledInstructions": None, "compiledAt": None,
                                 "promptConfig": {}, "metadata": {}}))
    with patch("livekit_poc_agent.runtime_config.httpx.AsyncClient", return_value=client):
        cfg = await runtime_config.fetch(base_url="http://x", api_key="mgk_x")
    assert cfg.compiled_instructions is None
    assert cfg.compiled_at is None


@pytest.mark.asyncio
async def test_fetch_raises_on_http_error():
    """401/403/etc. should propagate so the worker logs visibly and falls back."""
    client = _client(_resp(401, text="Unauthorized"))
    with patch("livekit_poc_agent.runtime_config.httpx.AsyncClient", return_value=client):
        with pytest.raises(httpx.HTTPStatusError):
            await runtime_config.fetch(base_url="http://x", api_key="mgk_bad")


def test_resolve_instructions_prefers_compiled_prompt():
    """If the agent has been compiled, that prompt wins over any fallback."""
    cfg = runtime_config.RuntimeConfig(
        id="x", name="n", slug="s", modality="voice",
        agent_platform="livekit", model_family="gpt", is_active=True,
        compiled_instructions="LATEST FROM DASHBOARD",
        compiled_at="2026-04-01T00:00:00.000Z",
        prompt_config={}, metadata={},
    )
    assert (
        runtime_config.resolve_instructions(cfg, fallback="OLD")
        == "LATEST FROM DASHBOARD"
    )


def test_resolve_instructions_falls_back_when_uncompiled():
    """If the dashboard never compiled, use the baked-in fallback so the worker
    doesn't crash and the call still completes."""
    cfg = runtime_config.RuntimeConfig(
        id="x", name="n", slug="s", modality="voice",
        agent_platform="livekit", model_family="gpt", is_active=True,
        compiled_instructions=None, compiled_at=None,
        prompt_config={}, metadata={},
    )
    assert runtime_config.resolve_instructions(cfg, fallback="DEFAULT") == "DEFAULT"


def test_resolve_instructions_falls_back_when_empty_string():
    """Empty string is treated as 'not compiled' — same as None."""
    cfg = runtime_config.RuntimeConfig(
        id="x", name="n", slug="s", modality="voice",
        agent_platform="livekit", model_family="gpt", is_active=True,
        compiled_instructions="   ", compiled_at=None,
        prompt_config={}, metadata={},
    )
    assert runtime_config.resolve_instructions(cfg, fallback="DEFAULT") == "DEFAULT"
