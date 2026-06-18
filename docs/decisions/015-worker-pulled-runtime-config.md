# ADR-015: Worker-Pulled Runtime Config for LiveKit Voice Agents

**Status:** Proposed (POC)

## Context

ADR-014 shipped browser voice testing — admins can click **Talk to agent** on the agent detail page and start a WebRTC conversation with the configured LiveKit worker. Once that loop existed, the next gap was obvious: **prompt edits don't reach the worker without a redeploy.**

The example LiveKit worker (`examples/agents/livekit-agent/src/buildpro.py`) bakes its system prompt into the Python package via `prompts/base.py`. A dashboard user can compile a new prompt, click Talk, and hear *the old prompt*. The compiled prompt sits in `agents.compiledInstructions` in the DB; the worker has never heard of it.

ADR-014 deliberately rejected the "obvious" fix — embedding the compiled prompt in LiveKit dispatch metadata — for two reasons:

1. It creates an asymmetry where voice-test uses prompt X but real inbound calls use prompt Y. "Works in test, broke in prod."
2. Prompts can be tens of KBs; dispatch metadata is the wrong envelope (LiveKit caps it ~48KB; the byte-size guards become load-bearing).

We agree with that rejection. We need a path that doesn't suffer from either failure mode.

## Decision

The worker **pulls** its own current runtime config from ModelGuide via its existing agent API key at session start.

Concretely:

1. **API endpoint** — `GET /api/agents/me/runtime-config`, gated by `requireAgent()` (agent API key auth, not user JWT). The endpoint resolves the agent from the bearer token, so the worker never needs to embed its own agent ID. Returns `{ id, name, slug, modality, modelFamily, agentPlatform, promptConfig, compiledInstructions, compiledAt }`.

2. **Worker client** — `mg_client.fetch_runtime_config()` calls that endpoint, returning the parsed payload on success and `None` on any failure (HTTP error, transport error, timeout). A stale prompt is always better than a hard crash mid-call.

3. **Resolution policy** — `mg_client.resolve_instructions(fetched, local)` picks the dashboard-compiled prompt when it's a non-empty string, otherwise falls back to the locally bundled prompt. The local prompt remains the floor: an agent that has never been compiled still has something to say.

4. **Wiring** — `agent.py` (entrypoint) calls `fetch_runtime_config()` once per room, passes the result to `BuildProAgent`, which threads it through `resolve_instructions()` before calling `super().__init__(instructions=...)`.

The fetch happens for **every flow** — voice-test, inbound SIP, outbound SIP — so there is no test/prod asymmetry. The pulled prompt is the prompt the user just compiled.

## Why pull, not push

| Concern | Push (rejected in ADR-014) | Pull (this ADR) |
|---|---|---|
| Test/prod parity | Voice-test gets the injected prompt, real calls get the worker's bundled prompt | Both call the same fetch path |
| Size limits | LiveKit metadata cap (~48KB) becomes load-bearing | HTTP body, no practical cap for our prompts |
| Source of truth | Dispatch metadata duplicates DB state | DB is authoritative; worker reads from DB |
| Failure mode | Empty room if metadata is malformed | Falls back to local prompt; call still works |
| Auth surface | Anyone with dispatch rights can inject a prompt | Worker must own a valid agent API key |
| Cold-start cost | None — prompt is in the dispatch | One extra HTTP GET (~30ms in-region) |

The pull cost is the only real trade-off. We accept it: 30ms is invisible against the existing 2s click-to-audio budget from ADR-014, and a failed fetch is a hard fallback to the bundled prompt — not a broken call.

## What this deliberately does NOT do

- **No runtime tool config.** The endpoint returns prompt + identity, not connector tool assignments. Tool wiring still flows through MCP, where it can be hot-reloaded on the existing connection. Mixing the two would couple the prompt loop to the MCP catalog loop and turn one careful endpoint into two.
- **No caching.** The fetch happens once per voice session. Caching adds invalidation problems for a path that already takes O(seconds) end-to-end. Revisit if voice sessions per minute climbs into the hundreds.
- **No streaming.** This is a one-shot bootstrap, not a long-poll. Mid-call prompt updates are out of scope; the operator can hang up and try again.
- **No "compiled prompt required" gate.** The endpoint happily returns `compiledInstructions: null` for agents that have never compiled — the worker's local prompt covers that case.

## Endpoint shape

`GET /api/agents/me/runtime-config`

| Status | Condition |
|---|---|
| 200 | Returns runtime config for the agent owning this API key |
| 401 | Missing / invalid agent API key (user JWTs are explicitly rejected by `requireAgent()`) |

The route is registered before `/:id` in `agents.routes.ts` so the literal `me` segment isn't routed to the UUID-typed get/update handlers.

### Why "me" (singular) instead of "/agents/:id/runtime-config"

The agent API key carries the agent identity. Asking the caller to also embed its own ID in the URL is redundant and creates a class of bugs where the URL says A but the key belongs to B. We resolve the agent from the token, full stop. Same pattern as `/users/me` on the dashboard side.

## Security

- API key auth via the existing `verifyApiKey` middleware (SHA-256 hashed at rest, `mgk_` prefix, scoped to a single agent, deactivation revokes immediately).
- Payload excludes secrets — no API keys, no connector configs, no webhook URLs. Just the prompt and the metadata needed to identify which agent's prompt it is.
- An exfiltrated API key already grants MCP tool execution; exposing the compiled prompt is a strictly smaller blast radius.

## Alternatives considered

**Push prompt via dispatch metadata** — rejected in ADR-014 for the test/prod-asymmetry and size reasons summarized above.

**Embed prompt in the LiveKit access token** — token has hard size limits, encoded in URL params during connect; same drawbacks as dispatch metadata with worse failure modes.

**Push prompt via SSE / WebSocket from API to worker** — would require new transport, new auth, new reconnect logic. The fetch path uses the worker's existing API key and existing HTTP client. Revisit if we add mid-call updates.

**Reuse `GET /api/agents/:id`** with relaxed auth — would either require API keys to see another agent's record (security regression) or a separate auth branch (effectively this ADR). The dedicated endpoint is cheaper and easier to reason about.

## Consequences

- **Closes the loop.** Click *Compile prompt* in the dashboard, click *Talk to agent*, hear the new prompt. No worker redeploy.
- **One extra HTTP call per voice session.** ~30ms in-region, soft-fails to the bundled prompt on any error.
- **The example worker now treats the bundled prompt as a floor, not a ceiling.** Scenario customization still happens by editing `prompts/`, but the dashboard's compiled prompt overrides it whenever it's set.
- **TTS warm-up uses the resolved prompt.** `_warmup_prompt_cache()` in `agent.py` sends `agent.instructions` to the LLM as the system message; that now warms the cache for whichever prompt actually runs.
- **The endpoint is small surface area.** It's a read of one row plus formatting — easy to keep stable as a public-ish contract for future custom workers.

## Test coverage

- **API integration** (`modelguide-api/tests/integration/agents.test.ts`):
  - 401 without auth
  - 401 with user JWT (agent-only endpoint)
  - 200 returns the right shape, including `compiledInstructions` and `promptConfig`
  - 200 with `null` compiled prompt for never-compiled agents
- **Worker unit** (`examples/agents/livekit-agent/tests/test_runtime_config.py`):
  - Hits the correct endpoint path
  - Returns parsed payload on 200
  - Returns `None` on HTTP error (no crash)
  - Returns `None` on transport error (no crash)
  - `resolve_instructions()` policy: prefer fetched compiled prompt; fall back to local when fetched is `None`, blank, or missing

Both test suites were written before the implementation (red → green TDD) and live alongside the existing API and worker tests.

## Related

- ADR-011: LiveKit Outbound Calls — established the dispatch + worker pattern.
- ADR-014: Browser Voice Testing — established the voice-test surface this ADR closes the prompt loop on. Read ADR-014's "Embed prompt in metadata" rejection alongside this ADR's pull-vs-push table.
