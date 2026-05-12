# ADR-015: Agent Runtime Config Fetch — Worker Pulls Latest Compiled Prompt

**Status:** Accepted

## Context

ADR-014 shipped browser voice testing — click "Talk to agent", token + dispatch, WebRTC into a LiveKit room. It explicitly rejected injecting a prompt into the dispatch metadata: the worker's profile owned the prompt, and tests that exercise a *different* prompt than production would be a "works in voice-test, broken in prod" trap.

That left a gap. The dashboard has a "compile prompt" flow (ADR-005 SOPs → compiler → `compiledInstructions` on the agent row), but the LiveKit worker has no way to see the compiled prompt. The existing `examples/agents/livekit-agent` bakes its prompt in via `from prompts import build_system_prompt` — local Python source, not the ModelGuide database. Operators who want to test a compiled prompt have to either:

1. Manually copy the compiled prompt into the worker's Python source and redeploy, or
2. Run a separate prototype build, also with a copied prompt, also requiring redeploy.

Both are antithetical to the "type prompt → click Test → talk" loop that voiceblox-style prototypes offer.

## Decision

Add `GET /api/agents/runtime-config`, authenticated by the agent's scoped API key. The endpoint returns:

```json
{
  "id": "uuid",
  "slug": "support_v1",
  "name": "Support Bot",
  "modality": "voice",
  "modelFamily": "gpt",
  "agentPlatform": "livekit",
  "compiledInstructions": "<latest compiled system prompt or null>",
  "compiledAt": "<ISO timestamp or null>",
  "promptConfig": { "persona": "...", "language": "en", "fillerPhrases": [...] }
}
```

Self-hosted workers (the new `examples/agents/livekit-prototype-agent`, and any custom worker an operator builds) call this at the start of every session and feed `compiledInstructions` into the LiveKit `Agent`. The dashboard's `VoiceTestPanel` surfaces a `compiledAt` timestamp so the operator can see what version they're about to hear.

### Why "pull from worker", not "push from API"

Three alternatives were considered:

| Approach | Verdict |
|---|---|
| Inject prompt into dispatch metadata at voice-test time | Rejected (ADR-014). Drifts from prod behaviour. |
| Push new prompt to worker via LiveKit `update_agent` or similar control plane | No portable LiveKit primitive exists for this. Workers vary; the API would have to know about each. |
| Worker pulls config on session start | **Accepted.** Worker is in control of its own boot; single round-trip per session; no protocol coupling to LiveKit's control plane. |

The pull model also generalises naturally to non-LiveKit custom workers — they can use the same endpoint without any LiveKit-specific glue.

### Authentication & isolation

The endpoint reuses the existing agent API key auth (`requireAgent()` middleware). The agent ID is *derived from the auth context*, not from the URL — so the worker can only ever fetch *its own* config. Cross-org enumeration is structurally impossible, not just blocked by RLS. The integration test (`tests/integration/agents-runtime-config.test.ts`) locks this in.

### Response intentionally narrow

The endpoint omits:

- `secrets` map (the worker doesn't need the *IDs* of LiveKit/TTS/STT secrets; those credentials live on the dispatcher side anyway)
- `metadata` (may contain `webhook_hmac_secret` or platform-internal IDs — strictly off-limits)
- `apiKeyHash` / `keyPrefix` (the worker already authenticated; it has no use for its own hash)
- `compiledFrom` (provenance is a dashboard-side concern, not a worker concern)

This is a positive allow-list: future fields are explicit opt-ins via the response Zod schema, not accidental side-effects of `SELECT *`. The unit test `tests/unit/agents/runtime-config-shape.test.ts` enforces "exactly these keys, no more."

### Fallback behaviour in the worker

When `compiledInstructions` is `null` (agent created but never compiled), the worker uses a `FALLBACK_PROMPT` env var rather than going silent or refusing to start. This keeps the "configure LiveKit → click Talk → hear something" path working during initial setup. If `FALLBACK_PROMPT` is also empty, the worker logs and aborts the session — running an LLM with no instructions produces wildly off-script behaviour that would mask the real "you forgot to compile" problem.

## Alternatives Considered

**Embed compiled prompt in the agent's existing API key claims.** Rejected — would either bloat the API key (which is a single string passed in headers) or require a token-issuance round trip on every prompt change. The runtime-config endpoint *is* that round trip, but kept distinct from auth.

**Cache compiled prompt at the worker for N minutes.** Rejected for the prototype. The "compile → click Talk" loop has expectations of immediacy that a cache would violate. If the call rate ever becomes a problem (one fetch per session is fine for human-driven testing; might not be for high-volume production), a cache can be added behind the same interface without breaking the contract.

**Reuse `GET /api/agents/:id`.** Rejected — that endpoint is authenticated by user JWT + permission, and returns user-facing fields like `evalSuiteCount`, `keyPrefix`, `integrationUrls`. Different concerns, different audience. Splitting keeps the worker-facing surface small and the response schema stable.

## Consequences

- **Operators can iterate on prompts without redeploying the worker.** The prototype agent picks up the new prompt on the next "Talk to agent" click. This is the loop the voiceblox-style POC promises.
- **One HTTP round trip per session.** Negligible against the existing ~2s setup cost (LiveKit dispatch + WebRTC connect + agent boot).
- **Failure mode: API unreachable at session start = no session.** The prototype agent aborts rather than running with an empty prompt. This is intentional — silent fallback to a hardcoded prompt would make outages harder to diagnose. Operators should monitor session-creation errors on their worker.
- **Long-running worker code never sees prompt updates mid-call.** Prompts apply on session boundaries. This is the same property prompt-tuning workflows already assume.
- **Existing `examples/agents/livekit-agent` is unchanged.** It still uses its hardcoded `buildpro.py` prompts — appropriate for a customer-specific demo agent. The new `livekit-prototype-agent` is the example to copy when building a generic, prompt-driven worker.
- **Caching is a future option, not a present one.** When/if we add it, the contract (`fetch_runtime_config` returns the latest compiled prompt on every call) doesn't change — only the implementation behind it.

## Test coverage

- **API**: `tests/integration/agents-runtime-config.test.ts` (HTTP path, RLS isolation, latest-prompt guarantee, no stale cache, secrets stripped) and `tests/unit/agents/runtime-config-shape.test.ts` (Docker-free shape lock).
- **Python worker**: `examples/agents/livekit-prototype-agent/tests/test_runtime_config.py` (transport, auth header, error paths, fallback selection) and `test_agent_integration.py` (fetch + build composition).
- **UI**: `voice-test-panel.test.tsx` covers the compiled-prompt status banner.

Tests were written **red first** for both the API endpoint and the Python `fetch_runtime_config` — the implementations only landed after the failing tests pinned down the contract.

## Related

- ADR-005: SOPs as Core Primitive — defines the upstream "prompt compilation" pipeline this endpoint serves.
- ADR-011: LiveKit Outbound Calls — the dispatch pattern this complements.
- ADR-014: Browser Voice Testing — the missing prompt-update mechanism this fills.
