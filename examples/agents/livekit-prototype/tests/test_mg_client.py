"""Tests for the ModelGuide REST client.

The whole prototype hinges on ``fetch_runtime_config`` doing the right thing:
- pulls compiled prompt from the API at session start
- falls back to a baked-in default when the agent has never been compiled
- surfaces auth failures so the worker fails loudly rather than dispatching
  with stale/empty prompts

These are red→green tests written before the implementation in mg_client.py.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest


def _install_mock_transport(monkeypatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    """Wire ``mg_client._get_http_client`` to a client backed by a MockTransport.

    Patching the factory (rather than ``httpx.AsyncClient`` itself) avoids
    the recursive-construction trap that bites naive ``patch.object`` calls.
    """
    import mg_client

    mock_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://api.test",
        headers={"Authorization": "Bearer mgk_test"},
    )
    monkeypatch.setattr(mg_client, "_http_client", mock_client)


# ---------------------------------------------------------------------------
# fetch_runtime_config — happy path
# ---------------------------------------------------------------------------


async def test_fetch_runtime_config_returns_compiled_prompt(monkeypatch):
    """When the API returns a compiled prompt, the client surfaces it verbatim."""
    import config
    import mg_client

    config.validate()

    body = {
        "agentId": "11111111-1111-1111-1111-111111111111",
        "slug": "support-voice",
        "name": "Support Voice",
        "modality": "voice",
        "modelFamily": "gpt",
        "compiledInstructions": "You are a helpful, friendly assistant.",
        "compiledAt": "2026-03-01T10:00:00.000Z",
    }

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        # Contract: the worker hits /me/runtime-config (NOT /:id/...) — auth
        # alone identifies the agent. If this drifts we'll get a 404 in prod.
        seen["path"] = request.url.path
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json=body)

    _install_mock_transport(monkeypatch, handler)
    cfg = await mg_client.fetch_runtime_config()

    assert seen["path"] == "/api/agents/me/runtime-config"
    assert seen["auth"] == "Bearer mgk_test"
    assert cfg.agent_id == body["agentId"]
    assert cfg.slug == body["slug"]
    assert cfg.name == body["name"]
    assert cfg.compiled_instructions == body["compiledInstructions"]
    assert cfg.compiled_at == body["compiledAt"]


# ---------------------------------------------------------------------------
# fetch_runtime_config — uncompiled agent
# ---------------------------------------------------------------------------


async def test_fetch_runtime_config_falls_back_when_uncompiled(monkeypatch):
    """A brand-new agent with no compiled prompt returns the fallback string.

    The fallback exists so the LiveKit worker never dispatches with an empty
    prompt — that would confuse callers ("why is the agent silent?") far
    more than an explicit "give the operator a moment" message.
    """
    import config
    import mg_client

    config.validate()

    body = {
        "agentId": "22222222-2222-2222-2222-222222222222",
        "slug": "uncompiled",
        "name": "Uncompiled Agent",
        "modality": "voice",
        "modelFamily": "generic",
        "compiledInstructions": None,
        "compiledAt": None,
    }

    _install_mock_transport(
        monkeypatch, lambda req: httpx.Response(200, json=body)
    )
    cfg = await mg_client.fetch_runtime_config()

    assert cfg.compiled_instructions is None
    assert cfg.compiled_at is None
    # resolve_instructions() is what the agent actually feeds to the LLM —
    # null compiled_instructions => fallback string, not empty.
    assert cfg.resolve_instructions() == config.FALLBACK_PROMPT


async def test_resolve_instructions_uses_compiled_prompt_when_present():
    """When compiled_instructions is non-empty, resolve_instructions returns it."""
    import mg_client

    cfg = mg_client.RuntimeConfig(
        agent_id="x",
        slug="x",
        name="x",
        modality="voice",
        model_family="gpt",
        compiled_instructions="Real prompt.",
        compiled_at="2026-03-01T10:00:00Z",
    )
    assert cfg.resolve_instructions() == "Real prompt."


async def test_resolve_instructions_falls_back_on_whitespace_only(monkeypatch):
    """A prompt of only whitespace counts as empty — protect callers from
    accidentally-cleared prompts in the dashboard rendering as silence."""
    import config
    import mg_client

    config.validate()

    cfg = mg_client.RuntimeConfig(
        agent_id="x",
        slug="x",
        name="x",
        modality="voice",
        model_family="gpt",
        compiled_instructions="   \n\t  ",
        compiled_at="2026-03-01T10:00:00Z",
    )
    assert cfg.resolve_instructions() == config.FALLBACK_PROMPT


# ---------------------------------------------------------------------------
# fetch_runtime_config — auth failure
# ---------------------------------------------------------------------------


async def test_fetch_runtime_config_raises_on_401(monkeypatch):
    """A 401 must surface as an exception, not get swallowed into a fallback.

    Silently falling back on auth failure would mask a misconfigured worker
    (wrong API key, deactivated agent) for the entire fleet — far better to
    crash-loop and force a fix.
    """
    import config
    import mg_client

    config.validate()

    _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(401, json={"error": "Agent auth required"}),
    )
    with pytest.raises(httpx.HTTPStatusError):
        await mg_client.fetch_runtime_config()


# ---------------------------------------------------------------------------
# Session lifecycle — thin, but worth pinning to a contract
# ---------------------------------------------------------------------------


async def test_create_session_posts_voice_channel(monkeypatch):
    """create_session() must POST channelType=voice — the API rejects others."""
    import config
    import mg_client

    config.validate()

    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200, json={"id": "33333333-3333-3333-3333-333333333333"}
        )

    _install_mock_transport(monkeypatch, handler)
    sid = await mg_client.create_session(user_identifier="caller@example.com")

    assert sid == "33333333-3333-3333-3333-333333333333"
    assert captured["path"] == "/api/sessions"
    assert captured["body"]["channelType"] == "voice"
    assert captured["body"]["userIdentifier"] == "caller@example.com"
