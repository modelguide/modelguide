"""Red-green TDD for PromptFetcher.

The fetcher is the one critical piece on the prototype agent's hot path:
it talks to ModelGuide every time a new room opens, so a click on "Compile"
in the dashboard reaches the LLM on the very next voice-test call. If this
helper drops fields, swallows errors silently, or sends the wrong header,
the agent talks with stale instructions and nobody notices until a customer
complains.

These tests pin the contract end-to-end:
  - the right HTTP shape leaves the box (URL, auth header)
  - the right Python shape comes back (compiled_instructions, prompt_config,
    agent identity)
  - the fallback path engages when compiled_instructions is null OR the
    network call fails — neither case should crash the entrypoint
"""

from __future__ import annotations

import httpx

from prompt_fetcher import (
    DEFAULT_FALLBACK_INSTRUCTIONS,
    FetchedPrompt,
    PromptFetcher,
)


# ---------------------------------------------------------------------------
# httpx MockTransport helpers — record every outbound request so the tests
# can assert on URL + headers in addition to response handling.
# ---------------------------------------------------------------------------


class _Recorder:
    def __init__(self, response_factory):
        self.requests: list[httpx.Request] = []
        self._response_factory = response_factory

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._response_factory(request)


def _client_with(response_factory) -> tuple[httpx.AsyncClient, _Recorder]:
    recorder = _Recorder(response_factory)
    transport = httpx.MockTransport(recorder)
    client = httpx.AsyncClient(
        transport=transport,
        base_url="http://localhost:3000",
        headers={"Authorization": "Bearer mgk_test_key"},
    )
    return client, recorder


# ---------------------------------------------------------------------------
# Happy path: compiled prompt available
# ---------------------------------------------------------------------------


async def test_fetch_returns_compiled_instructions_and_metadata():
    payload = {
        "agent": {
            "id": "11111111-1111-1111-1111-111111111111",
            "slug": "glowbox-concierge",
            "name": "GlowBox Concierge",
            "modality": "voice",
        },
        "compiledInstructions": "You are Sam, the GlowBox concierge.",
        "compiledAt": "2026-05-01T12:34:56.000Z",
        "promptConfig": {"persona": "Friendly", "language": "English"},
    }
    client, recorder = _client_with(
        lambda req: httpx.Response(200, json=payload)
    )

    fetcher = PromptFetcher(client)
    result = await fetcher.fetch()

    assert isinstance(result, FetchedPrompt)
    assert result.instructions == "You are Sam, the GlowBox concierge."
    assert result.is_fallback is False
    assert result.compiled_at == "2026-05-01T12:34:56.000Z"
    assert result.agent_name == "GlowBox Concierge"
    assert result.agent_slug == "glowbox-concierge"
    assert result.prompt_config["persona"] == "Friendly"


async def test_fetch_hits_me_prompt_endpoint_with_bearer_token():
    # If the URL or the auth header drifts the worker would happily 401 and
    # fall back to the stub prompt — silent degradation. Pin both.
    client, recorder = _client_with(
        lambda req: httpx.Response(
            200,
            json={
                "agent": {
                    "id": "x",
                    "slug": "x",
                    "name": "x",
                    "modality": "voice",
                },
                "compiledInstructions": "hi",
                "compiledAt": None,
                "promptConfig": {},
            },
        )
    )
    await PromptFetcher(client).fetch()

    assert len(recorder.requests) == 1
    req = recorder.requests[0]
    assert req.method == "GET"
    assert req.url.path == "/api/agents/me/prompt"
    assert req.headers["authorization"] == "Bearer mgk_test_key"


# ---------------------------------------------------------------------------
# Fallback: agent never compiled
# ---------------------------------------------------------------------------


async def test_fetch_uses_fallback_when_compiled_instructions_is_null():
    # Brand-new agents have prompt_config but no compiled output yet. The
    # worker must still come up with *some* prompt so the call doesn't sit
    # silent — the operator can finish compiling and click "Talk to agent"
    # again to pick up the real prompt.
    payload = {
        "agent": {
            "id": "x",
            "slug": "x",
            "name": "Uncompiled Agent",
            "modality": "voice",
        },
        "compiledInstructions": None,
        "compiledAt": None,
        "promptConfig": {},
    }
    client, _ = _client_with(lambda req: httpx.Response(200, json=payload))

    result = await PromptFetcher(client).fetch()

    assert result.is_fallback is True
    assert result.instructions == DEFAULT_FALLBACK_INSTRUCTIONS
    assert result.agent_name == "Uncompiled Agent"


# ---------------------------------------------------------------------------
# Fallback: transport / status errors
# ---------------------------------------------------------------------------


async def test_fetch_falls_back_on_http_error_status():
    # 401, 404, 5xx all collapse to the fallback prompt. We log the failure
    # but never raise — a dead control-plane shouldn't take out the call.
    client, _ = _client_with(lambda req: httpx.Response(401, text="nope"))
    result = await PromptFetcher(client).fetch()

    assert result.is_fallback is True
    assert result.instructions == DEFAULT_FALLBACK_INSTRUCTIONS
    assert result.agent_name is None


async def test_fetch_falls_back_on_network_error():
    def boom(_req):
        raise httpx.ConnectError("connection refused")

    client, _ = _client_with(boom)
    result = await PromptFetcher(client).fetch()

    assert result.is_fallback is True
    assert result.instructions == DEFAULT_FALLBACK_INSTRUCTIONS


async def test_fetch_falls_back_on_malformed_json():
    # Some upstream proxies (and old test fixtures) return 200 with HTML.
    # The fetcher must treat that as "no prompt" rather than crashing.
    client, _ = _client_with(
        lambda req: httpx.Response(200, content=b"<html>oops</html>")
    )
    result = await PromptFetcher(client).fetch()

    assert result.is_fallback is True
    assert result.instructions == DEFAULT_FALLBACK_INSTRUCTIONS
