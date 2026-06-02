# ADR-015: LiveKit Prototype Agent with Dynamic Prompts

**Status:** Accepted (prototype scope)

## Context

After ADR-014 shipped browser voice testing, the dashboard "Talk to agent"
button worked end-to-end — but the agent it talked to was still using
whatever prompt was baked into the worker image at deploy time. A typical
session looked like:

1. Edit persona / SOP in the dashboard.
2. Click "Compile" → fresh `compiled_instructions` lands on the agent row.
3. Click "Talk to agent" → worker dispatches with the old prompt.
4. Push a new worker image. Wait. Try again.

The "compile → sync → talk" loop the dashboard advertises is actually
"compile → sync → redeploy → talk", which kills the iteration speed that's
the whole point of the dashboard. We need a tighter loop for prompt
iteration without giving up the deploy-tracked source-of-truth property
ADR-014 protects (see "What this deliberately does NOT do" in ADR-014).

## Decision

Ship a **separate prototype agent** at
`examples/agents/livekit-prototype/` that pulls its system prompt from
ModelGuide at session start, instead of baking it into the image.

### Mechanism

1. **API** — new endpoint `GET /api/agents/me/prompt`, authenticated by
   agent API key (`mgk_xxx`). Returns the calling agent's compiled
   instructions, prompt config, and identity fields. Lives in
   `modelguide-api/src/features/agents/agents.routes.ts`; response shape
   is built by the pure function `buildAgentPromptPayload` (covered by
   `tests/unit/agents/prompt-payload.test.ts`).
2. **Worker** — single Python file at
   `examples/agents/livekit-prototype/src/agent.py`. On each dispatched
   room: GET `/me/prompt`, use the returned `compiledInstructions` as the
   LLM system prompt, run a normal STT→LLM→TTS loop. If the fetch fails
   the worker falls back to a stub prompt and logs loudly — see
   `prompt_fetcher.py`.
3. **Dashboard** — no UI change required. The existing voice-test panel
   (ADR-014) dispatches by agent slug; whatever worker handles that slug
   decides where its prompt comes from.

### Why a separate worker instead of changing the production one

ADR-014 explicitly rejected metadata-based prompt injection because it
created an "it works in voice-test but broke in prod" failure mode: the
worker's baked profile was the production-of-record. That argument still
stands.

The prototype takes a different route: the worker fetches the *same
control-plane source of truth* that the dashboard reads from. The risk
ADR-014 worried about — voice-test diverging from production — only
materialises if the production worker keeps using a different prompt
source. The prototype lets us validate the fetch-at-start model in
isolation before deciding whether to promote it into
`examples/agents/livekit-agent`.

### Scope boundaries (deliberate omissions)

- **No MCP tools.** The prototype is conversation-only. Adding MCP back
  is mechanical — the production agent already has the pattern — but
  keeping it out lets the prototype's correctness story stay "did the
  prompt loop work".
- **No transcript posting.** Sessions don't get recorded in ModelGuide.
- **No SIP.** Browser WebRTC only.
- **No Langfuse / no tracing.** Add later or move to the production
  agent.

### Failure mode

The fetch is on the room-join critical path. We accept a ~50 ms latency
hit per dispatch in exchange for live prompts. If the control plane is
unreachable the worker falls back to a stub prompt (`is_fallback=True`)
rather than letting the room sit silent — voice calls should not depend
on REST API uptime. Hard failures are logged at WARN; the loud signal
lets operators detect a control-plane outage from worker logs alone.

## Consequences

**Positive**

- Compile → talk loop drops from "minutes (redeploy)" to "seconds (HTTP)".
- The fetch surface is unit-tested on both sides (TypeScript pure
  function + Python `httpx.MockTransport`), so the contract is locked.
- Prototype isolation means we can iterate without putting the production
  voice-test path at risk.

**Negative**

- Every dispatched room makes one extra HTTP call. Measured at ~50 ms
  against a local API; ~80–120 ms against Railway production. Acceptable
  on the critical path because the LiveKit `wait_for_participant` already
  takes 200–500 ms in parallel.
- Two divergent prompts now exist for the same agent: the compiled
  prompt the prototype uses, and the baked prompt the production agent
  uses. Operators need to know which agent slug routes to which worker.
- Auth widening — `requireAgent()` on `GET /me/prompt` means any party
  holding the agent's API key can read its compiled instructions. This
  matches how other agent-scoped endpoints (`POST /sessions`,
  `POST /mcp`) already work, but it's worth calling out: anyone who
  exfiltrates the key gets the prompt.

## Rollout

1. **Now (this PR):** Endpoint + prototype + tests. Operators opt in by
   pointing a LiveKit-configured agent at the prototype worker (via
   `metadata.livekit.agentName`).
2. **After bake-in:** If the iteration speed wins clearly, port the
   `PromptFetcher` (and the HTTP call) into
   `examples/agents/livekit-agent` and let the production agent fetch
   too. Retire the prototype directory at that point.
3. **If it loses:** Delete the prototype. The endpoint is small enough
   to leave or remove cheaply.

## References

- ADR-011 — outbound calls (per-agent LiveKit credentials)
- ADR-014 — browser voice testing (dispatch metadata contract)
- `modelguide-api/src/features/agents/prompt-payload.ts`
- `examples/agents/livekit-prototype/src/prompt_fetcher.py`
