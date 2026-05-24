"""Tests for ``mg_prompt`` — the runtime compiled-prompt fetcher.

The prototype agent's whole point is to fetch the latest compiled prompt at
session start, so every error path here corresponds to a visible failure in
the "Talk to agent" dashboard flow:

  * 401 → "your API key is wrong, fix it in the env"
  * 404 → "the agent that owns this key is gone"
  * compiledInstructions=None → "click Compile in the dashboard"
  * 5xx / non-JSON → "ModelGuide is misbehaving — surface and retry"

We mock httpx with an in-process transport so the tests never touch a
real network and run synchronously fast in CI.
"""

from __future__ import annotations

import httpx
import pytest

from mg_prompt import (
    AgentSelf,
    MissingCompiledPrompt,
    PromptFetchError,
    PromptFetchUnauthorized,
    fetch_agent_self,
    fetch_compiled_prompt,
)

API_URL = "https://api.modelguide.test"
API_KEY = "mgk_test_key_for_unit_tests"


def _client(handler) -> httpx.AsyncClient:
    """Build an AsyncClient backed by an in-process MockTransport.

    Each test calls this with a callable that receives the request and
    returns an ``httpx.Response`` — no real socket is opened.
    """
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _agent_payload(**overrides):
    """A complete /api/agents/me response. Override individual fields
    per test instead of duplicating the shape everywhere."""
    base = {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "Prototype Agent",
        "slug": "prototype_v1",
        "description": None,
        "modality": "voice",
        "modelFamily": "gpt",
        "promptConfig": {},
        "agentPlatform": "livekit",
        "isActive": True,
        "evalSuiteCount": 0,
        "secrets": {},
        "hasElevenLabsKey": False,
        "hasWebhookSecret": False,
        "keyPrefix": None,
        "compiledInstructions": "You are a helpful prototype assistant.",
        "compiledAt": "2025-01-01T00:00:00.000Z",
        "compiledFrom": None,
        "createdAt": "2025-01-01T00:00:00.000Z",
        "updatedAt": None,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_agent_self_on_200():
    """The fetcher parses the API response into AgentSelf verbatim."""

    def handler(req: httpx.Request) -> httpx.Response:
        # Verify the request shape the worker sends — if this drifts, the
        # API's auth middleware won't accept the request.
        assert req.method == "GET"
        assert req.url.path == "/api/agents/me"
        assert req.headers["authorization"] == f"Bearer {API_KEY}"
        return httpx.Response(200, json=_agent_payload())

    async with _client(handler) as c:
        result = await fetch_agent_self(API_URL, API_KEY, client=c)

    assert isinstance(result, AgentSelf)
    assert result.id == "00000000-0000-0000-0000-000000000001"
    assert result.slug == "prototype_v1"
    assert result.modality == "voice"
    assert result.agent_platform == "livekit"
    assert result.is_active is True
    assert result.compiled_instructions == "You are a helpful prototype assistant."
    assert result.compiled_at == "2025-01-01T00:00:00.000Z"


@pytest.mark.asyncio
async def test_fetch_compiled_prompt_returns_just_the_string():
    """The convenience wrapper returns the instructions, not the full object."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_agent_payload(compiledInstructions="ROLE: hard-coded prompt"),
        )

    async with _client(handler) as c:
        prompt = await fetch_compiled_prompt(API_URL, API_KEY, client=c)

    assert prompt == "ROLE: hard-coded prompt"


@pytest.mark.asyncio
async def test_strips_trailing_slash_from_api_url():
    """Operators set MODELGUIDE_API_URL either with or without a trailing slash.

    The fetcher normalizes both — otherwise the request URL has a duplicate
    slash and some reverse proxies will 404 it.
    """
    seen_paths: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen_paths.append(req.url.path)
        return httpx.Response(200, json=_agent_payload())

    async with _client(handler) as c:
        await fetch_agent_self(f"{API_URL}/", API_KEY, client=c)

    assert seen_paths == ["/api/agents/me"]


# ---------------------------------------------------------------------------
# Auth failures
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raises_unauthorized_on_401():
    """A bad API key surfaces as PromptFetchUnauthorized — a distinct type
    so the worker can show "fix your env key" instead of "retry later"."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid token"})

    async with _client(handler) as c:
        with pytest.raises(PromptFetchUnauthorized):
            await fetch_agent_self(API_URL, API_KEY, client=c)


@pytest.mark.asyncio
async def test_raises_unauthorized_on_404():
    """If /me returns 404 the agent record is gone (deleted after the key
    was minted). We map 404 to Unauthorized because, from the worker's
    perspective, it's the same "your key no longer identifies a valid
    agent" condition."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "agent not found"})

    async with _client(handler) as c:
        with pytest.raises(PromptFetchUnauthorized):
            await fetch_agent_self(API_URL, API_KEY, client=c)


# ---------------------------------------------------------------------------
# Missing compile
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raises_missing_compiled_when_instructions_null():
    """The agent exists but has never been compiled — the dashboard's
    Compile button wasn't clicked. Raise so the worker can tell the
    operator exactly what to do instead of dispatching a generic LLM."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_agent_payload(compiledInstructions=None, compiledAt=None),
        )

    async with _client(handler) as c:
        with pytest.raises(MissingCompiledPrompt):
            await fetch_agent_self(API_URL, API_KEY, client=c)


@pytest.mark.asyncio
async def test_raises_missing_compiled_when_instructions_empty():
    """Defensive: treat an empty string the same as None. An empty system
    prompt silently degrades the LLM to a generic assistant — worse UX
    than a clear failure."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_agent_payload(compiledInstructions=""))

    async with _client(handler) as c:
        with pytest.raises(MissingCompiledPrompt):
            await fetch_agent_self(API_URL, API_KEY, client=c)


# ---------------------------------------------------------------------------
# Bad responses
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raises_on_500():
    """5xx is a server problem, not an auth problem. Use the generic
    PromptFetchError so the worker can apply a different retry policy
    than for 401s."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    async with _client(handler) as c:
        with pytest.raises(PromptFetchError) as info:
            await fetch_agent_self(API_URL, API_KEY, client=c)
        # Auth-class errors are PromptFetchUnauthorized; 500 must not
        # accidentally route through that branch.
        assert not isinstance(info.value, PromptFetchUnauthorized)


@pytest.mark.asyncio
async def test_raises_on_non_json_body():
    """A misrouted request that hits the UI's index.html instead of the
    API would return 200 + HTML. Catch this here instead of letting the
    JSON parser explode mid-LLM-init."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"<html>not the api</html>",
            headers={"content-type": "text/html"},
        )

    async with _client(handler) as c:
        with pytest.raises(PromptFetchError):
            await fetch_agent_self(API_URL, API_KEY, client=c)


@pytest.mark.asyncio
async def test_raises_on_array_body():
    """The /me endpoint must return an object — if it ever returns a
    list (refactor regression), bail before treating it as a dict."""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    async with _client(handler) as c:
        with pytest.raises(PromptFetchError):
            await fetch_agent_self(API_URL, API_KEY, client=c)
