"""Tests for the POC agent's ModelGuide client.

Locked behaviors:
  - The runtime-config response shape from the API decodes into the
    ``RuntimeConfig`` dataclass without dropping fields.
  - ``resolved_instructions()`` falls back to ``config.FALLBACK_INSTRUCTIONS``
    when ``compiledInstructions`` is null or whitespace-only.  The "no
    compiled prompt yet" UX is what the operator hears when they click
    Talk before Compile, so we lock the wording at this layer.
  - The Authorization header is the agent's API key (not a user JWT).
"""

from __future__ import annotations

import os

# Make sure config import doesn't blow up on REQUIRED vars.
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("DEEPGRAM_API_KEY", "test")
os.environ.setdefault("ELEVENLABS_API_KEY", "test")
os.environ.setdefault("MODELGUIDE_API_URL", "http://localhost:3000")
os.environ.setdefault("MODELGUIDE_API_KEY", "mgk_test")

import httpx
import pytest
import respx

import config
import mg_client

# Tests rely on the module-level constants populated by config.validate() —
# without this, MODELGUIDE_API_URL is "" and _url(path) returns just the path,
# which fails respx URL matching and httpx cookie parsing alike.
config.validate()


# ---------------------------------------------------------------------------
# RuntimeConfig decoding
# ---------------------------------------------------------------------------


def test_runtime_config_decodes_full_payload() -> None:
    payload = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Glowbox Voice",
        "slug": "glowbox-voice",
        "modality": "voice",
        "compiledInstructions": "You are Sam.",
        "compiledAt": "2026-05-20T12:00:00.000Z",
        "promptConfig": {"persona": "Sam"},
    }
    cfg = mg_client.RuntimeConfig.from_api(payload)
    assert cfg.id == "11111111-1111-1111-1111-111111111111"
    assert cfg.slug == "glowbox-voice"
    assert cfg.modality == "voice"
    assert cfg.compiled_instructions == "You are Sam."
    assert cfg.compiled_at == "2026-05-20T12:00:00.000Z"
    assert cfg.prompt_config == {"persona": "Sam"}


def test_runtime_config_tolerates_null_compiled_fields() -> None:
    # The API returns nulls when the operator hasn't compiled yet.  The
    # worker must not crash on the boot path — it falls back so the
    # operator can hear the agent saying "I'm not configured."
    cfg = mg_client.RuntimeConfig.from_api(
        {
            "id": "x",
            "name": "x",
            "slug": "x",
            "modality": "voice",
            "compiledInstructions": None,
            "compiledAt": None,
            "promptConfig": None,
        }
    )
    assert cfg.compiled_instructions is None
    assert cfg.compiled_at is None
    assert cfg.prompt_config == {}


def test_resolved_instructions_returns_compiled_when_present() -> None:
    cfg = mg_client.RuntimeConfig(
        id="x",
        name="x",
        slug="x",
        modality="voice",
        compiled_instructions="Use this prompt.",
        compiled_at="2026-05-20T12:00:00Z",
        prompt_config={},
    )
    assert cfg.resolved_instructions() == "Use this prompt."


def test_resolved_instructions_falls_back_when_missing_or_blank() -> None:
    # Empty / whitespace counts as missing — otherwise a "blank" prompt
    # would silently override the fallback and the agent would have no
    # instructions at all, leading to LLM-default behavior the operator
    # didn't configure.
    for value in (None, "", "   ", "\n\t"):
        cfg = mg_client.RuntimeConfig(
            id="x",
            name="x",
            slug="x",
            modality="voice",
            compiled_instructions=value,
            compiled_at=None,
            prompt_config={},
        )
        assert cfg.resolved_instructions() == config.FALLBACK_INSTRUCTIONS


# ---------------------------------------------------------------------------
# HTTP client wiring
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@respx.mock
async def test_fetch_runtime_config_sends_bearer_api_key() -> None:
    """The agent's API key authenticates the call — not a user JWT, not a
    cookie.  If this regresses, every voice-test bootstrap returns 401."""

    route = respx.get(
        f"{config.MODELGUIDE_API_URL}/api/agents/me/runtime-config"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "agent-1",
                "name": "Agent 1",
                "slug": "agent-1",
                "modality": "voice",
                "compiledInstructions": "Hi",
                "compiledAt": "2026-05-20T12:00:00.000Z",
                "promptConfig": {},
            },
        )
    )

    mg_client.set_http_client(None)
    try:
        cfg = await mg_client.fetch_runtime_config()
    finally:
        await mg_client.close_http_client()

    assert cfg.id == "agent-1"
    assert route.called
    sent = route.calls.last.request
    assert sent.headers["authorization"] == f"Bearer {config.MODELGUIDE_API_KEY}"


@pytest.mark.asyncio
@respx.mock
async def test_fetch_runtime_config_raises_on_401() -> None:
    """An invalid/revoked key should surface — don't fall back silently or
    the operator thinks the prompt is just empty when actually auth broke."""

    respx.get(
        f"{config.MODELGUIDE_API_URL}/api/agents/me/runtime-config"
    ).mock(return_value=httpx.Response(401, json={"error": "Unauthorized"}))

    mg_client.set_http_client(None)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await mg_client.fetch_runtime_config()
    finally:
        await mg_client.close_http_client()
