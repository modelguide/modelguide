"""Unit tests for the runtime-prompt-fetch path (ADR-015).

These cover ``fetch_agent_profile`` + ``resolve_instructions`` — the two
functions that make or break the "compile → click test → talk" loop.

If a field name in the API response drifts (the contract is locked by
``modelguide-api/tests/unit/agents/agent-me-shape.test.ts``), these tests
catch it on the Python side too.
"""

from __future__ import annotations

import httpx
import pytest

import mg_client


# ---------------------------------------------------------------------------
# AgentProfile.from_api
# ---------------------------------------------------------------------------


class TestAgentProfileFromApi:
    def test_parses_full_response(self) -> None:
        profile = mg_client.AgentProfile.from_api({
            "id": "agt_123",
            "name": "Sam",
            "slug": "buildpro_sam",
            "modality": "voice",
            "modelFamily": "gpt",
            "agentPlatform": "livekit",
            "isActive": True,
            "compiledInstructions": "Be warm and concise.",
            "compiledAt": "2026-01-15T12:00:00.000Z",
        })

        assert profile.id == "agt_123"
        assert profile.slug == "buildpro_sam"
        assert profile.compiled_instructions == "Be warm and concise."
        assert profile.compiled_at == "2026-01-15T12:00:00.000Z"
        assert profile.is_active is True

    def test_tolerates_missing_compiled_state(self) -> None:
        # When the dashboard operator hasn't compiled a prompt yet,
        # `compiledInstructions` and `compiledAt` come back as null.
        profile = mg_client.AgentProfile.from_api({
            "id": "agt_123",
            "name": "Sam",
            "slug": "buildpro_sam",
            "modality": "voice",
            "modelFamily": "gpt",
            "agentPlatform": "livekit",
            "isActive": True,
            "compiledInstructions": None,
            "compiledAt": None,
        })

        assert profile.compiled_instructions is None
        assert profile.compiled_at is None

    def test_defaults_optional_metadata_fields(self) -> None:
        # If the API ever ships a slimmer projection, the worker must still
        # boot — these defaults are why.
        profile = mg_client.AgentProfile.from_api({
            "id": "agt_123",
            "name": "Sam",
            "slug": "s",
            "modality": "voice",
            "compiledInstructions": "x",
            "compiledAt": "2026-01-15T12:00:00.000Z",
        })

        assert profile.model_family == "generic"
        assert profile.agent_platform == "livekit"
        assert profile.is_active is False


# ---------------------------------------------------------------------------
# resolve_instructions
# ---------------------------------------------------------------------------


def _profile(compiled: str | None) -> mg_client.AgentProfile:
    return mg_client.AgentProfile(
        id="x",
        name="x",
        slug="x",
        modality="voice",
        model_family="gpt",
        agent_platform="livekit",
        is_active=True,
        compiled_instructions=compiled,
        compiled_at=None,
    )


class TestResolveInstructions:
    def test_prefers_compiled_when_present(self) -> None:
        result = mg_client.resolve_instructions(
            _profile("Latest compiled prompt"),
            fallback="Stub",
        )
        assert result == "Latest compiled prompt"

    def test_falls_back_when_compiled_is_none(self) -> None:
        result = mg_client.resolve_instructions(_profile(None), fallback="Stub")
        assert result == "Stub"

    def test_falls_back_when_compiled_is_whitespace_only(self) -> None:
        # "" or "   " should be treated the same as None — operators
        # sometimes clear the prompt to a blank string by accident.
        assert mg_client.resolve_instructions(_profile(""), "Stub") == "Stub"
        assert mg_client.resolve_instructions(_profile("   \n"), "Stub") == "Stub"

    def test_does_not_strip_meaningful_whitespace(self) -> None:
        # The compiled prompt may legitimately contain leading newlines
        # (e.g. a markdown heading). Don't mangle it.
        prompt = "\n# Persona\nYou are Sam."
        result = mg_client.resolve_instructions(_profile(prompt), "Stub")
        assert result == prompt


# ---------------------------------------------------------------------------
# fetch_agent_profile (HTTP)
# ---------------------------------------------------------------------------


def _async_client(handler) -> httpx.AsyncClient:
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


class TestFetchAgentProfile:
    @pytest.mark.asyncio
    async def test_returns_profile_on_200(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/agents/me"
            assert request.headers["Authorization"] == "Bearer mgk_test_key"
            return httpx.Response(200, json={
                "id": "agt_123",
                "name": "Sam",
                "slug": "sam",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "isActive": True,
                "compiledInstructions": "Hello.",
                "compiledAt": "2026-01-15T12:00:00.000Z",
            })

        async with _async_client(handler) as client:
            profile = await mg_client.fetch_agent_profile(
                "http://localhost:3000",
                "mgk_test_key",
                client=client,
            )

        assert profile.slug == "sam"
        assert profile.compiled_instructions == "Hello."

    @pytest.mark.asyncio
    async def test_strips_trailing_slash_from_base_url(self) -> None:
        seen_paths: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_paths.append(request.url.path)
            return httpx.Response(200, json={
                "id": "x", "name": "x", "slug": "x", "modality": "voice",
                "compiledInstructions": None, "compiledAt": None,
            })

        async with _async_client(handler) as client:
            await mg_client.fetch_agent_profile(
                "http://localhost:3000/", "mgk_test", client=client,
            )

        # No double slash — important because some hosts (Railway, nginx)
        # reject `//api/...` as a separate route.
        assert seen_paths == ["/api/agents/me"]

    @pytest.mark.asyncio
    async def test_raises_modelguide_error_on_401(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "unauthorized"})

        async with _async_client(handler) as client:
            with pytest.raises(mg_client.ModelGuideError) as ctx:
                await mg_client.fetch_agent_profile(
                    "http://localhost:3000", "mgk_bad", client=client,
                )
        # The error message must call out the API key explicitly — that's
        # the #1 misconfiguration the operator hits.
        assert "API key" in str(ctx.value)

    @pytest.mark.asyncio
    async def test_raises_modelguide_error_on_5xx(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="upstream down")

        async with _async_client(handler) as client:
            with pytest.raises(mg_client.ModelGuideError) as ctx:
                await mg_client.fetch_agent_profile(
                    "http://localhost:3000", "mgk_test", client=client,
                )
        assert "503" in str(ctx.value)

    @pytest.mark.asyncio
    async def test_raises_modelguide_error_on_transport_failure(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        async with _async_client(handler) as client:
            with pytest.raises(mg_client.ModelGuideError):
                await mg_client.fetch_agent_profile(
                    "http://localhost:3000", "mgk_test", client=client,
                )

    @pytest.mark.asyncio
    async def test_raises_modelguide_error_on_non_json_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="<html>not json</html>")

        async with _async_client(handler) as client:
            with pytest.raises(mg_client.ModelGuideError):
                await mg_client.fetch_agent_profile(
                    "http://localhost:3000", "mgk_test", client=client,
                )
