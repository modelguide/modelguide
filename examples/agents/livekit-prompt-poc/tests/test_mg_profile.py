"""Tests for the dynamic prompt loader (``mg_profile``).

The LiveKit POC worker pulls its system prompt from ``GET /api/agents/me``
at job start, using its own ModelGuide API key. These tests pin down the
contract:

  - parse a well-formed self-profile response
  - fall back to a sensible default when the agent has not been compiled
  - propagate auth failures so the worker can refuse to start
"""

from __future__ import annotations

import json

import httpx
import pytest

import mg_profile


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_compiled_response() -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "POC Voice Agent",
        "slug": "poc-voice-agent",
        "description": "Test agent",
        "modality": "voice",
        "modelFamily": "gpt",
        "promptConfig": {"persona": "Helpful", "language": "en"},
        "agentPlatform": "livekit",
        "isActive": True,
        "compiledInstructions": "You are a helpful voice agent.",
        "compiledAt": "2026-06-05T12:34:56.000Z",
        "compiledFrom": {
            "sops": [
                {
                    "sopId": "22222222-2222-2222-2222-222222222222",
                    "sopName": "Onboarding",
                    "stepCount": 4,
                }
            ],
            "guardrailIds": [],
            "toolCount": 0,
        },
    }


@pytest.fixture
def fake_uncompiled_response(fake_compiled_response: dict) -> dict:
    out = dict(fake_compiled_response)
    out["compiledInstructions"] = None
    out["compiledAt"] = None
    out["compiledFrom"] = None
    return out


def _mock_transport(handler):
    """Build an httpx.AsyncClient backed by a callable handler."""
    return httpx.AsyncClient(
        base_url="https://example.test",
        transport=httpx.MockTransport(handler),
        headers={"Authorization": "Bearer mgk_test_key"},
    )


# ---------------------------------------------------------------------------
# fetch_profile
# ---------------------------------------------------------------------------


class TestFetchProfile:
    async def test_returns_parsed_profile_with_compiled_prompt(
        self, fake_compiled_response: dict
    ) -> None:
        captured: dict[str, str | None] = {"path": None, "auth": None}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["path"] = request.url.path
            captured["auth"] = request.headers.get("authorization")
            return httpx.Response(200, json=fake_compiled_response)

        async with _mock_transport(handler) as client:
            profile = await mg_profile.fetch_profile(client)

        # Hits the documented self-endpoint with the bearer key.
        assert captured["path"] == "/api/agents/me"
        assert captured["auth"] == "Bearer mgk_test_key"

        assert profile.id == fake_compiled_response["id"]
        assert profile.name == "POC Voice Agent"
        assert profile.slug == "poc-voice-agent"
        assert profile.compiled_instructions == "You are a helpful voice agent."
        assert profile.compiled_at == "2026-06-05T12:34:56.000Z"
        assert profile.has_compiled_prompt is True
        assert profile.prompt_config == {
            "persona": "Helpful",
            "language": "en",
        }

    async def test_handles_uncompiled_agent(
        self, fake_uncompiled_response: dict
    ) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=fake_uncompiled_response)

        async with _mock_transport(handler) as client:
            profile = await mg_profile.fetch_profile(client)

        assert profile.compiled_instructions is None
        assert profile.compiled_at is None
        assert profile.has_compiled_prompt is False

    async def test_raises_on_unauthorized(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "Unauthorized"})

        async with _mock_transport(handler) as client:
            with pytest.raises(mg_profile.ProfileFetchError) as excinfo:
                await mg_profile.fetch_profile(client)

        assert "401" in str(excinfo.value)


# ---------------------------------------------------------------------------
# resolve_system_prompt
# ---------------------------------------------------------------------------


class TestResolveSystemPrompt:
    def test_uses_compiled_instructions_when_present(self) -> None:
        profile = mg_profile.AgentProfile(
            id="a",
            name="Acme",
            slug="acme",
            compiled_instructions="ACME live prompt.",
            compiled_at="2026-06-05T00:00:00Z",
            prompt_config={},
            modality="voice",
            model_family="gpt",
        )

        prompt = mg_profile.resolve_system_prompt(profile)
        assert prompt == "ACME live prompt."

    def test_falls_back_to_stub_when_no_compiled_prompt(self) -> None:
        profile = mg_profile.AgentProfile(
            id="a",
            name="Acme",
            slug="acme",
            compiled_instructions=None,
            compiled_at=None,
            prompt_config={},
            modality="voice",
            model_family="gpt",
        )

        prompt = mg_profile.resolve_system_prompt(profile)
        # Fallback must clearly identify the agent so the operator immediately
        # sees "I'm talking to the un-compiled agent" rather than a generic
        # canned voice.
        assert "Acme" in prompt
        assert "compiled prompt" in prompt.lower()
