# ADR-015: LiveKit Prototype Agent — Runtime Compiled-Prompt Fetch

**Status:** Accepted (prototype-only)

## Context

[ADR-014](./014-browser-voice-testing.md) shipped the one-click
"Talk to agent" flow but kept the worker's prompt baked into its image.
That decision was correct for production workers — it removes a drift-in-
testing failure mode where the voice-test sounds right but the deployed
worker is on a stale prompt. It also makes the dispatch-metadata blob
small enough to round-trip through LiveKit's metadata caps safely.

It is, however, terrible for **prompt iteration**. Today the loop is:

1. Edit the SOP in the dashboard.
2. Click **Compile Prompt**.
3. Wait for the worker image to rebuild (Docker, CI, redeploy to LiveKit
   Cloud) — minutes per attempt.
4. Click **Talk to agent**.

For a contractor tweaking persona language or trying out a new tool
ordering, that loop is too slow to be useful. Several internal builders
have asked: "can I just click *Compile* and then *Talk* and have the
agent use what I just compiled?" — and the answer under ADR-014 is
"no, redeploy first".

We want a "yes" answer for prototypes, without subsidizing the failure
mode that ADR-014 was paid to avoid.

## Decision

Ship a parallel **prototype worker** (`examples/agents/livekit-prototype/`)
that fetches its prompt + tool catalog from ModelGuide at session start,
backed by a new agent-authenticated REST endpoint:

```
GET /api/agents/me
Authorization: Bearer mgk_<agent_api_key>
```

The endpoint returns the same shape as `GET /api/agents/:id` — including
`compiledInstructions` and `compiledFrom` — but is scoped to the agent
that owns the calling API key. No cross-org enumeration is possible
because the key identifies the agent (and therefore the org) directly.

The worker's session-start sequence becomes:

```
ctx.connect()
   → GET /api/agents/me         (compiled prompt → system instructions)
   → MCP ListTools              (tool catalog → dynamic @function_tool wrappers)
   → ctx.wait_for_participant()
   → AgentSession.start()
```

Both the prompt and the tool list refresh on every dispatch, so a
"compile + click Talk to agent" iteration takes seconds, not minutes.

### Why a separate worker (not a flag on the existing one)

Adding a `RUNTIME_PROMPT_FETCH=true` flag to the BuildPro worker would
mean every code path in `buildpro.py` needs to defend against the prompt
not being baked-in (greeting strings, prompt-cache warmup, the tool map
which is wired by hand to specific tool names). The blast radius is
larger than the value. A separate, minimal worker:

- Is short enough (<200 lines) that the runtime-fetch path is the whole
  worker, not a branch within it.
- Keeps the production BuildPro flow exactly as ADR-014 specified — no
  conditional logic, no risk of a flag flip changing prod behavior.
- Documents itself by existing as a stand-alone example.

### Endpoint shape

`GET /api/agents/me` — permission: `requireAgent()` (API key auth only).

| Status | Condition |
|---|---|
| 200 | API key is valid, agent is active. Body matches `agentResponseSchema` (same as `GET /:id`). |
| 401 | No auth header, invalid `mgk_…`, expired key, key revoked, or agent inactive. |
| 404 | Agent record was deleted between key mint and call (rare). |

The response intentionally has the **same shape** as `GET /:id` — the
prototype Python client uses only `id` and `compiledInstructions`, but
reusing the schema means UI code that already renders agents can be
pointed at this endpoint without divergence. No new schema to drift.

### Security posture

The endpoint is strictly more conservative than `POST /api/sessions`
(which agents already use) — it's read-only and returns nothing the
caller doesn't already implicitly know:

- The API key already proves "I am this agent". `/me` adds zero new
  enumeration surface — there is no path to learn about agents other
  than yourself.
- Agent records contain **secret references** (`secrets` is a UUID→UUID
  ref map) but **no decrypted values**. The integration test pins this:
  every value in `secrets` must be a UUID, never a token-shaped string.
- We strip `webhook_hmac_secret` from `metadata` (same as `GET /:id`),
  so a worker that re-leaks the response to a less-trusted log target
  doesn't disclose the HMAC.
- Plaintext API key never appears in the response — only `keyPrefix`.

### What this deliberately does NOT do

- **Does not extend the production worker.** ADR-014's drift-in-testing
  concern is real for production. Operators who want runtime updates
  use the prototype; operators who want the safety of a vendored prompt
  use the production worker.
- **Does not pre-cache.** The worker pays one extra HTTP round-trip per
  session start (~50ms LAN, ~200ms cross-region). Compared to the LLM
  TTFT (typically 800ms+) this is negligible, and caching adds
  invalidation complexity that would partially defeat the point ("but
  I clicked Compile and it still sounds old").
- **Does not surface in the dashboard as a feature toggle.** Picking
  between workers happens at LiveKit-config time (set
  `metadata.livekit.agentName` to the prototype's name vs. the
  production worker's name). The UI doesn't need to know which kind
  of worker it's dispatching into — both consume the same metadata.

## Alternatives Considered

**Inject the prompt into LiveKit dispatch metadata.** The ADR-014 closed
issues (#234, #239) explored this. Rejected then for two reasons that
still apply: (1) metadata byte caps require multi-kilobyte prompts to
be chunked, and (2) the metadata-in-dispatch path is a different
codepath than what production runs, so the test signal is weak. Going
through the regular agent-auth REST endpoint reuses the same auth and
the same response shape the rest of the platform already uses.

**Mint a one-shot pre-signed URL per dispatch.** Considered for "the
worker doesn't need a long-lived API key". Rejected because the worker
already needs the API key for MCP calls — minting an additional
short-lived credential just to read its own prompt would double the
key-management surface without removing the underlying long-lived key.

**Push prompts to the worker via a control-plane subscription** (NATS,
Kafka, etc.). Rejected as massively over-engineered for a prototype.
The pull model is fine — calls are infrequent (one fetch per session
start), bandwidth is trivial.

**Hot-swap the prompt mid-session if the user clicks Compile while
talking.** Tempting, but mid-session swap creates a new failure mode
("the agent suddenly changes character mid-call"). Pull-on-start is the
right grain: one stable prompt per conversation.

## Consequences

- Iterating on a prompt against a deployed prototype worker is now
  **edit → Compile → Talk** with no redeploy. Estimated 10-50× speedup
  on the inner loop.
- The `/api/agents/me` endpoint becomes a small but load-bearing surface.
  If it ever returns the wrong agent's record (e.g. a JWT-vs-API-key
  middleware mix-up), a worker would talk with the wrong prompt and
  the wrong tools. Mitigation: the integration test in
  `tests/integration/agents.test.ts` includes a cross-org isolation
  check (`orgB key returns orgB agent`) and a no-JWT check (`401 for
  user JWT auth`) — both are load-bearing.
- The drift-in-testing risk ADR-014 named is now real for the prototype:
  "the voice-test sounded good, then I deployed BuildPro and it
  regressed." Mitigation: README explicitly scopes the prototype to
  iteration use, not deployment, and lists what's missing vs the
  production worker (SIP, transcript posting, Langfuse, hang-up state
  machine).
- The MCP tool wiring is dynamic — whatever connectors are assigned
  show up. This means a tool added in the dashboard becomes available
  on the next call without a code change. Useful for prototyping, but
  it also means the LLM may try to call a tool whose backend has known
  issues. Compared to the BuildPro worker's `STUBBED_TOOLS` env, this
  is a regression in fault containment we accept for the prototype.
- The endpoint passes through `compiledFrom` (SOPs, guardrail IDs,
  tool count). If a future worker wants to refuse to start when, e.g.,
  the compile is more than 30 days stale, it has the data it needs.

## Test coverage

**API side** (`tests/integration/agents.test.ts`):

- `GET /api/agents/me` with a valid agent key → 200 + agent shape
- secret material does not leak (no plaintext key, no HMAC, secrets
  ref map contains only UUIDs)
- orgB key returns orgB agent — never orgA (cross-org isolation)
- user JWT → 401 (endpoint is agent-only)
- no auth → 401
- invalid `mgk_…` → 401
- `/me` does not collide with `/:id` UUID-param route

**Worker side** (`examples/agents/livekit-prototype/tests/`):

- `fetch_agent_self` — happy path returns parsed `AgentSelf`
- `fetch_compiled_prompt` — convenience wrapper returns the string
- URL trailing-slash normalization (prevents `//api/...` 404s)
- 401, 404 → `PromptFetchUnauthorized`
- `compiledInstructions=None` or `""` → `MissingCompiledPrompt`
  (workers fall back to a placeholder prompt)
- 500, non-JSON body, array body → `PromptFetchError`
- `mcp_url_for` builds `{api}/mcp/{agent_id}`
- `build_tool_description` embeds the schema for LLM tool calls

15 Python tests, 7 new API integration assertions. No new mocks beyond
`httpx.MockTransport` in the worker tests.

## Related

- [ADR-011](./011-livekit-outbound-calls.md) — original outbound dispatch
  pattern, shares `dispatchAgentToRoom`.
- [ADR-014](./014-browser-voice-testing.md) — browser voice testing,
  decided that prompts should NOT travel in dispatch metadata. This
  ADR explicitly accepts that decision for production while offering
  the prototype escape hatch.
- `examples/agents/livekit-agent/` — the production BuildPro worker
  that keeps the baked-prompt invariant.
- `examples/agents/livekit-prototype/` — this prototype.
