# Prompt Sync — Talk to the agent with your latest compiled prompt

This document describes the **POC** that closes the loop from "edit prompt in the dashboard" to "hear it in a browser voice test", without redeploying the LiveKit worker.

The pieces:

| Piece | What it does | Where it lives |
|---|---|---|
| `GET /api/agents/me/runtime-config` | Returns the agent's compiled prompt + prompt config, authenticated by the agent's own API key | `modelguide-api/src/features/agents/agents.routes.ts` |
| `mg_client.fetch_runtime_config()` | Worker-side fetch with graceful fallback to local | `examples/agents/livekit-agent/src/mg_client.py` |
| `BuildProAgent(runtime_config=...)` | Threads the resolved prompt into the LiveKit agent's `instructions` | `examples/agents/livekit-agent/src/buildpro.py` |
| Voice Test panel | Existing "Talk to agent" button on the agent detail page | `modelguide-ui/src/features/agents/components/voice-test-panel.tsx` |

## The loop

```
Dashboard (modelguide-ui)
   │
   │ 1. Edit prompt config (persona / language / filler phrases)
   │ 2. Click "Compile Prompt" → POST /api/agents/:id/compile
   │ 3. agents.compiledInstructions written to Postgres
   │ 4. Click "Talk to agent" → POST /api/agents/:id/voice-test-token
   │     → API dispatches the LiveKit worker into a fresh room
   ▼
LiveKit worker (examples/agents/livekit-agent)
   │
   │ 5. entrypoint() fires for the new room
   │ 6. mg_client.fetch_runtime_config()  ── GET /api/agents/me/runtime-config
   │ 7. BuildProAgent(runtime_config=…)   ── resolve_instructions(fetched, local)
   │ 8. AgentSession starts with the freshly-fetched prompt
   ▼
Browser ◄── WebRTC audio ── Speaks with the new prompt
```

Step 6 is the new bit. Everything else already existed (see ADR-014 for the voice-test dispatch).

## Trying it locally

You need a working LiveKit dev setup — see [README.md](./README.md) for the three-terminal flow. With that running:

```bash
# 1. Open the dashboard, navigate to an agent detail page
make ui-dev

# 2. Edit the persona / language / filler phrases under Prompt → Configuration,
#    save the configuration.

# 3. Switch to Prompt → Compiled and click "Compile Prompt".

# 4. Scroll down to Voice Test and click "Talk to agent".
#    Look in the worker logs for:
#      mg_client | INFO | runtime-config fetched: agent=... slug=... compiled=True
#      buildpro  | INFO | Using dashboard-compiled prompt (N chars, agent=...)
```

If you see `compiled=False`, the dashboard hasn't compiled a prompt for this agent yet (or the compiled column is null). The worker falls back to the bundled `prompts/base.py` and the call still works — that's the safety net.

## What if the fetch fails?

`fetch_runtime_config()` returns `None` on:

- HTTP non-2xx (e.g. expired API key → 401, agent inactive → 401)
- transport errors (DNS, connection refused, timeout)
- any other exception

`resolve_instructions(None, local)` then returns the local prompt. The voice call still connects and the agent still talks — just with the pre-deployment prompt. The failure is logged, not raised. We prefer a stale prompt to a dropped call.

## Where the contract lives

The endpoint is small on purpose. If you need to add a field:

1. Add the column read in `getAgentRuntimeConfig` (`modelguide-api/src/features/agents/agents.service.ts`).
2. Add it to `agentRuntimeConfigResponseSchema` in `agents.routes.ts`.
3. Read it on the worker side and decide the policy (override? merge? bail?).

Don't dump arbitrary `metadata.*` into the response — the endpoint is read by external workers and stays a stable contract by keeping its shape small. See ADR-015 for the boundary rationale.

## Tests

- API integration: `modelguide-api/tests/integration/agents.test.ts` → `describe("GET /api/agents/me/runtime-config")`
- Worker unit: `examples/agents/livekit-agent/tests/test_runtime_config.py`

Both were written before the implementation (red-green TDD). Run them with:

```bash
# API integration (requires a running Postgres; CI runs them in pipelines)
make api-test-integration

# Worker unit (no infra needed)
cd examples/agents/livekit-agent
uv sync --extra test
uv run pytest tests/test_runtime_config.py -v
```

## Status & follow-ups

This is a POC. Status in [ADR-015](../../../docs/decisions/015-worker-pulled-runtime-config.md): **Proposed**. The path is wired end-to-end and tested, but a few rough edges remain before it's production-ready:

- The worker fetches on every room. Hundreds of voice sessions per minute would put real load on the API. Add a 5-30s cache (keyed on agent slug) before we exceed that volume.
- There's no mid-call refresh. Editing a prompt during a live call has no effect until the next call. Out of scope for this POC.
- The example agent (`BuildProAgent`) still owns scenario-specific Python (the 11 `@function_tool` methods, the cart state machine, the guardrails). Only the system prompt is dynamic. A fully prompt-driven worker — where tools come from MCP catalog discovery and the agent class is a thin shell — is a separate, larger project.
