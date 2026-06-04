"""Tests for the minimal ModelGuide REST client."""

import httpx
import pytest
import respx

import mg_client


@pytest.mark.asyncio
@respx.mock
async def test_fetch_runtime_config_uses_bearer_auth_and_correct_path():
    route = respx.get("http://localhost:3000/api/agents/me").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "agt_1",
                "slug": "sam",
                "name": "Sam",
                "modality": "voice",
                "modelFamily": "gpt",
                "agentPlatform": "livekit",
                "isActive": True,
                "promptConfig": {},
                "metadata": {},
                "compiledInstructions": "Hi",
                "compiledAt": None,
                "updatedAt": None,
            },
        )
    )

    cfg = await mg_client.fetch_runtime_config()
    assert cfg.id == "agt_1"
    assert cfg.compiled_instructions == "Hi"

    # Ensure the worker authenticates with the agent's mgk_ key.
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer mgk_test_key"

    # Cleanup the pooled http client so it doesn't leak between tests.
    await mg_client.close_http_client()


@pytest.mark.asyncio
@respx.mock
async def test_fetch_runtime_config_raises_on_401():
    respx.get("http://localhost:3000/api/agents/me").mock(
        return_value=httpx.Response(401, json={"code": "UNAUTHORIZED"})
    )

    with pytest.raises(httpx.HTTPStatusError):
        await mg_client.fetch_runtime_config()

    await mg_client.close_http_client()


@pytest.mark.asyncio
@respx.mock
async def test_create_session_posts_channel_and_user():
    route = respx.post("http://localhost:3000/api/sessions").mock(
        return_value=httpx.Response(201, json={"id": "sess_xyz"})
    )

    session_id = await mg_client.create_session("caller@example.com")
    assert session_id == "sess_xyz"

    body = route.calls.last.request.content.decode()
    assert "voice" in body
    assert "caller@example.com" in body

    await mg_client.close_http_client()
