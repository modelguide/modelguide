# ADR-015: LiveKit POC Worker — Prompt-Driven Iteration

**Status:** Accepted

## Context

ADR-014 added "Talk to agent" — one-click browser WebRTC into the
configured production worker. The dispatch metadata carries `agentName`
(the agent's slug); the worker reads it, picks a profile from its
in-memory registry, and starts. The prompt + tools for that profile are
**baked into the worker image** at build time. That section of ADR-014
spells out why injecting a prompt at dispatch time was rejected:

> Earlier iterations shipped a `prompt_override` / `instructions_override`
> field … We rejected this because the worker's profile is the
> authoritative source of prompt + tools. Injecting a different prompt
> creates a "it works in voice-test but broke in prod" failure mode.

That trade-off is correct for the canonical "talk to the live agent" UX,
and ADR-014 stands. But it leaves a UX gap for prompt iteration:

- Operator edits a SOP / compiles the agent in the dashboard.
- To hear the change, they must redeploy the production worker (image
  rebuild + LiveKit Cloud rollout, minutes to tens of minutes).
- The "Talk to agent" button gives them the **previously deployed**
  prompt, not the one they just compiled.

Voiceblox-style projects ([voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox))
demonstrate a different posture: a thin, prompt-driven worker that does
nothing but boot a session with whatever instructions the caller hands
it. Cheaper to iterate on, useless for production tool flows.

## Decision

Ship a **second**, additional LiveKit worker — `examples/agents/livekit-poc/`
— purpose-built for prompt iteration. It coexists with the production
worker; neither replaces the other.

### Worker behaviour

On every job the POC worker:

1. Parses `ctx.job.metadata` as JSON.
2. Extracts `agent_id` (UUID, new — see below).
3. Calls `GET /api/agents/{agent_id}` with the worker's own
   `MODELGUIDE_API_KEY` and reads `compiledInstructions` off the
   response.
4. Constructs `Agent(instructions=…)` from that text.
5. Falls back to a clearly-labelled default prompt if any of (a) no
   `agent_id` provided, (b) the API call fails, (c) the agent has no
   `compiledInstructions` (operator never clicked Compile).

The worker has **no MCP, no tools, no scenario logic**. It exists only
to read a prompt and produce audio from it. ~200 lines of Python total.

### API change

`buildVoiceTestDispatchMetadata` gains one additive field:

```ts
{
  mode: "voice-test",
  agentName: string,      // unchanged — production worker reads this
  agent_id: string,       // NEW — POC worker reads this
  session_id: string,
  user_identifier: string,
  email: string,
}
```

`agent_id` is the agent's UUID (immutable, primary key). The production
worker ignores it. The POC worker uses it to fetch the prompt.

Naming intentionally:

- `agent_id` snake_case to match the rest of the payload (and ADR-014's
  comment about Python-side conventions).
- We pass the **ID**, not the **slug**, because slugs can be renamed via
  the dashboard mid-test. A UUID survives renames.
- We pass the **ID**, not the **prompt text**, because that's the line
  ADR-014 rejected — we're not putting a prompt on the wire, just a
  lookup key.

### Selection

Per-agent. The agent's `metadata.livekit.agentName` is the LiveKit
worker name to dispatch into:

- `agentName = "<customer>-voice-agent"` → the production worker.
- `agentName = "livekit-poc"` → this worker (when configured).

Operators pick by editing the agent's LiveKit config in the dashboard.
No new UI surface required for the POC; the existing voice-test panel
just dispatches into whichever worker the agent points at.

### What this deliberately does NOT do

- **No prompt injection on the wire.** The dispatch metadata carries an
  ID, not the compiled prompt itself. ADR-014's argument about
  test-vs-prod drift, byte-size guards (50K char / 48KB metadata caps),
  and the "build a new profile if you want to test a new prompt"
  alternative still applies to the production worker.
- **No worker-side prompt cache.** Every session refetches. A 24-hour
  cached prompt would defeat the purpose of "test the version I just
  compiled."
- **No tool execution.** If an operator wants to test tool flows, they
  use the production worker via "Talk to agent" or, in headless form,
  via the simulation engine (ADR-008).
- **No new endpoint.** Reuses `POST /agents/:id/voice-test-token`. The
  metadata is additive; the route shape is unchanged.

### Endpoint shape

Unchanged from ADR-014. The only API delta is one new field in dispatch
metadata.

## Alternatives Considered

**Inject the compiled prompt directly in dispatch metadata.** Rejected,
per ADR-014. We use the agent ID + a server-side fetch instead.

**Add a new endpoint `POST /agents/:id/poc-voice-token`.** Rejected as
over-engineered: the existing endpoint already creates a session and
dispatches a worker. The only thing that needs to change per-agent is
which worker name is dispatched to, and that's already configurable per
agent. A new endpoint would duplicate the orchestration for no
behavioural difference.

**Make the production worker hot-reload prompts from ModelGuide.**
Rejected. The production worker's contract is "WYSIWYG: what was
deployed is what runs." Hot-reloading prompts couples a prod worker's
behaviour to dashboard state (a SOP edit becomes a prod change without
a CI gate). The POC's "always fresh" is the right default for
iteration and the wrong default for production.

**Ship a third "preview" mode in the production worker (read prompt
from MG if a flag is set in dispatch metadata).** Rejected. Same
worker, two modes of operation, two failure surfaces, twice the test
matrix. A second worker is cheap; mode-switching a single worker is
the start of a feature-flag proliferation.

**Skip the worker, drive the LLM directly from the dashboard with no
audio.** Rejected. We already have that (the prompt-compiler preview
in `modelguide-ui`). The point of the POC is to hear the prompt in
voice, which is the actual production medium.

## Consequences

- **Operators gain a fast prompt-iteration loop.** Compile → click test
  → hear the new prompt in under ~5 seconds (token + dispatch + WebRTC
  + agent boot + prompt fetch).
- **`agent_id` in dispatch metadata is now load-bearing for the POC
  worker.** The contract test `voice-test-dispatch.test.ts` locks the
  field name and behaviour (echoed verbatim, independent of agentName).
- **Two workers to keep deployed.** A small operational cost. The POC
  worker has no per-customer state — one instance can serve every org.
- **Fallback path is reachable in production.** When the API is down or
  the agent isn't compiled, the operator hears a fallback prompt
  telling them what's wrong. This is intentional — a silent room is
  worse than a generic-but-honest greeting.
- **No tool testing in the POC.** If a prompt change needs to be
  validated against tools, the operator still rebuilds the production
  worker. The POC narrows the iteration loop for the most common case
  (prompt tone / wording / structure), not all cases.

## Known test gap

The agent.py entrypoint itself is not covered by tests — exercising
`AgentSession.start` requires standing up a LiveKit dev server in CI,
which is out of scope. Coverage instead targets the pieces that
actually own behaviour:

- `prompt_loader.load_prompt` — fetch + four fallback paths, all mocked
  against `httpx`. 12 test cases.
- `prompt_loader.extract_agent_id` — dispatch metadata parsing, 4
  cases.
- `transcript.TranscriptCollector` — ordering, whitespace, JSON-shape
  for the API post.
- `config.validate` — required vars, URL normalization, idempotence.
- API side: `buildVoiceTestDispatchMetadata` — 8 cases, including two
  new ones that lock the `agent_id` contract.

Net risk: a refactor that reorders the entrypoint orchestration (e.g.
fetches the prompt *after* `session.start`) would pass CI. Follow-up:
if this worker becomes load-bearing in production iteration, add an
integration test that spins up a LiveKit dev server in a CI sidecar
and asserts a session can be entered end-to-end.

## Related

- ADR-014: Browser Voice Testing via LiveKit Dispatch — the flow this extends.
- ADR-011: LiveKit Outbound Calls — original dispatch + metadata pattern.
- ADR-008: Persona Simulation — headless prompt iteration (no voice).
