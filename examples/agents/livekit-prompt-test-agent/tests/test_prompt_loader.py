"""Tests for the dynamic prompt loader.

The loader is the single thing that makes this agent different from the
baked-prompt buildpro example: it fetches `compiledInstructions` from
ModelGuide's `GET /api/agents/me` endpoint on every session, so a fresh
compile in the dashboard is picked up by the very next "Talk to agent"
click without redeploying the worker.

These tests are deliberately blocking on the loader's contract:
- it must call the right URL with the agent API key
- it must return the compiled prompt verbatim
- it must fall back gracefully when the prompt is missing or the API is
  down, because "no prompt" is recoverable (use a default) but a hard
  crash on a single-call API blip would silently fail every voice test.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from prompt_loader import (
    FALLBACK_PROMPT,
    AgentProfile,
    PromptLoadError,
    fetch_agent_profile,
    load_prompt,
)


def _httpx_mock_transport(handler) -> httpx.AsyncClient:
    """Build an httpx.AsyncClient backed by a MockTransport handler."""
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport, base_url="http://mg.test")


# ----------------------------------------------------------------------
# fetch_agent_profile — the raw API call
# ----------------------------------------------------------------------


class TestFetchAgentProfile:
    @pytest.mark.asyncio
    async def test_calls_agents_me_with_bearer_token(self):
        """Loader must hit GET /api/agents/me with the API key as Bearer."""
        seen_requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_requests.append(request)
            return httpx.Response(
                200,
                json={
                    "id": "agt_abc",
                    "name": "Voice Agent",
                    "slug": "voice-agent",
                    "compiledInstructions": "You are a helpful assistant.",
                    "compiledAt": "2025-01-01T00:00:00Z",
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            await fetch_agent_profile(
                client, api_url="http://mg.test", api_key="mgk_secret"
            )
        finally:
            await client.aclose()

        assert len(seen_requests) == 1
        req = seen_requests[0]
        assert req.method == "GET"
        assert req.url.path == "/api/agents/me"
        assert req.headers["authorization"] == "Bearer mgk_secret"

    @pytest.mark.asyncio
    async def test_returns_parsed_profile_with_compiled_prompt(self):
        compiled = "You are Sam, a helpful contractor supply assistant."

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "id": "agt_sam",
                    "name": "Sam",
                    "slug": "buildpro-sam",
                    "compiledInstructions": compiled,
                    "compiledAt": "2025-01-01T00:00:00Z",
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            profile = await fetch_agent_profile(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert isinstance(profile, AgentProfile)
        assert profile.id == "agt_sam"
        assert profile.slug == "buildpro-sam"
        assert profile.compiled_prompt == compiled
        assert profile.is_active is True

    @pytest.mark.asyncio
    async def test_returns_profile_with_null_compiled_prompt(self):
        """Fresh agent — no prompt compiled yet. Profile loads, prompt is None."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "id": "agt_fresh",
                    "name": "Fresh",
                    "slug": "fresh-agent",
                    "compiledInstructions": None,
                    "compiledAt": None,
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            profile = await fetch_agent_profile(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert profile.compiled_prompt is None

    @pytest.mark.asyncio
    async def test_raises_prompt_load_error_on_401(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"code": "UNAUTHORIZED"})

        client = _httpx_mock_transport(handler)
        try:
            with pytest.raises(PromptLoadError):
                await fetch_agent_profile(
                    client, api_url="http://mg.test", api_key="mgk_bad"
                )
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_raises_prompt_load_error_on_500(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"code": "INTERNAL"})

        client = _httpx_mock_transport(handler)
        try:
            with pytest.raises(PromptLoadError):
                await fetch_agent_profile(
                    client, api_url="http://mg.test", api_key="mgk_x"
                )
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_raises_prompt_load_error_on_transport_failure(self):
        """Network failure / DNS error / connection refused."""

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        client = _httpx_mock_transport(handler)
        try:
            with pytest.raises(PromptLoadError):
                await fetch_agent_profile(
                    client, api_url="http://mg.test", api_key="mgk_x"
                )
        finally:
            await client.aclose()


# ----------------------------------------------------------------------
# load_prompt — the top-level helper used by the agent entrypoint.
#
# Returns the *string* that the LLM will see as its system prompt:
#   1. If the API returns a non-empty compiledInstructions → use that.
#   2. If the API returns null/empty → use FALLBACK_PROMPT (configurable,
#      keeps the call alive so the operator can hear the fallback rather
#      than getting silence).
#   3. If the API call fails → use FALLBACK_PROMPT and log loudly. We
#      explicitly do NOT crash the worker because the voice call has
#      already started in the browser by the time the fetch fires.
# ----------------------------------------------------------------------


class TestLoadPrompt:
    @pytest.mark.asyncio
    async def test_returns_compiled_prompt_when_present(self):
        compiled = "Be brief. Be helpful. Be honest."

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "id": "agt_x",
                    "name": "X",
                    "slug": "x",
                    "compiledInstructions": compiled,
                    "compiledAt": "2025-01-01T00:00:00Z",
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            prompt = await load_prompt(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert prompt == compiled

    @pytest.mark.asyncio
    async def test_falls_back_when_compiled_prompt_missing(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "id": "agt_fresh",
                    "name": "Fresh",
                    "slug": "fresh",
                    "compiledInstructions": None,
                    "compiledAt": None,
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            prompt = await load_prompt(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert prompt == FALLBACK_PROMPT

    @pytest.mark.asyncio
    async def test_falls_back_on_empty_string_prompt(self):
        """Treat empty/whitespace prompts the same as null."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "id": "agt_x",
                    "name": "X",
                    "slug": "x",
                    "compiledInstructions": "   ",
                    "compiledAt": None,
                    "compiledFrom": None,
                    "agentPlatform": "livekit",
                    "modality": "voice",
                    "isActive": True,
                },
            )

        client = _httpx_mock_transport(handler)
        try:
            prompt = await load_prompt(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert prompt == FALLBACK_PROMPT

    @pytest.mark.asyncio
    async def test_falls_back_on_api_failure(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, json={"code": "UNAVAILABLE"})

        client = _httpx_mock_transport(handler)
        try:
            prompt = await load_prompt(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert prompt == FALLBACK_PROMPT

    @pytest.mark.asyncio
    async def test_falls_back_on_transport_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        client = _httpx_mock_transport(handler)
        try:
            prompt = await load_prompt(
                client, api_url="http://mg.test", api_key="mgk_x"
            )
        finally:
            await client.aclose()

        assert prompt == FALLBACK_PROMPT
