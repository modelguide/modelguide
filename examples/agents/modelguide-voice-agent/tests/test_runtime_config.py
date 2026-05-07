"""Tests for the runtime-config HTTP client.

The whole point of this agent is "click Compile in the dashboard, then click
Voice Test, and the next call uses the freshly compiled prompt." That hinges
on a single GET against ``/api/agents/me/runtime-config`` at job-start.

These tests exercise that fetch in isolation with a mocked transport.
"""

import httpx
import pytest
import respx

from runtime_config import (
    RuntimeConfig,
    RuntimeConfigError,
    fetch_runtime_config,
)


@pytest.mark.asyncio
class TestFetchRuntimeConfig:
    async def test_returns_compiled_prompt(self):
        with respx.mock(base_url="https://mg.example.com") as router:
            router.get("/api/agents/me/runtime-config").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "agent-id",
                        "slug": "glowbox-voice",
                        "name": "GlowBox Voice",
                        "modality": "voice",
                        "modelFamily": "gpt",
                        "instructions": "You are GlowBox.",
                        "compiledAt": "2026-05-07T10:00:00.000Z",
                    },
                )
            )
            cfg = await fetch_runtime_config(
                "https://mg.example.com",
                "mgk_test123",
            )
        assert isinstance(cfg, RuntimeConfig)
        assert cfg.id == "agent-id"
        assert cfg.slug == "glowbox-voice"
        assert cfg.instructions == "You are GlowBox."
        assert cfg.has_compiled_prompt is True

    async def test_handles_uncompiled_agent(self):
        # Until the dashboard-side "Compile" button has been clicked at least
        # once, instructions is null. The agent must NOT crash — it should
        # surface this so the worker can pick a fallback prompt.
        with respx.mock(base_url="https://mg.example.com") as router:
            router.get("/api/agents/me/runtime-config").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "agent-id",
                        "slug": "fresh",
                        "name": "Fresh",
                        "modality": "voice",
                        "modelFamily": "generic",
                        "instructions": None,
                        "compiledAt": None,
                    },
                )
            )
            cfg = await fetch_runtime_config(
                "https://mg.example.com", "mgk_test"
            )
        assert cfg.instructions is None
        assert cfg.has_compiled_prompt is False

    async def test_sends_bearer_authorization_header(self):
        # The runtime-config endpoint requires API-key auth; using JWT or no
        # auth would 401. Lock the header shape here so a refactor of the
        # client can't silently drop it.
        with respx.mock(base_url="https://mg.example.com") as router:
            route = router.get("/api/agents/me/runtime-config").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "a",
                        "slug": "s",
                        "name": "n",
                        "modality": "voice",
                        "modelFamily": "gpt",
                        "instructions": "x",
                        "compiledAt": None,
                    },
                )
            )
            await fetch_runtime_config(
                "https://mg.example.com",
                "mgk_my_secret_key",
            )
        assert route.called
        sent = route.calls.last.request
        assert sent.headers["authorization"] == "Bearer mgk_my_secret_key"

    async def test_strips_trailing_slash_from_base_url(self):
        with respx.mock(base_url="https://mg.example.com") as router:
            route = router.get("/api/agents/me/runtime-config").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "a",
                        "slug": "s",
                        "name": "n",
                        "modality": "voice",
                        "modelFamily": "gpt",
                        "instructions": "x",
                        "compiledAt": None,
                    },
                )
            )
            # Trailing slash variant — should normalize to the same URL.
            await fetch_runtime_config(
                "https://mg.example.com/",
                "mgk_t",
            )
        assert route.called

    async def test_raises_on_unauthorized(self):
        with respx.mock(base_url="https://mg.example.com") as router:
            router.get("/api/agents/me/runtime-config").mock(
                return_value=httpx.Response(
                    401, json={"error": "unauthorized"}
                )
            )
            with pytest.raises(RuntimeConfigError):
                await fetch_runtime_config(
                    "https://mg.example.com", "mgk_bad"
                )
