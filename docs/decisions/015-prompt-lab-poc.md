# ADR-015: Prompt Lab — Voice Test with Live Prompt Override (POC)

**Status:** Accepted (POC, time-boxed). Supersedes the "no prompt injection"
clause of ADR-014 for this single opt-in surface only.

## Context

ADR-014 (`docs/decisions/014-browser-voice-testing.md`) shipped a one-click
"Talk to agent" button on the agent detail page. It deliberately does **not**
let the operator inject a prompt at dispatch time — the worker's profile is
the authoritative source of prompt + tools, and an override path creates the
"works in voice-test but broke in prod" failure mode.

That decision is right for the production button. It's the wrong default for
the workflow we actually do day-to-day:

> Edit the SOP → recompile → redeploy the worker → wait for the deploy →
> click "Talk to agent" → discover the prompt change is bad → repeat.

The redeploy step alone is 60–120 seconds (Railway pull + image start +
worker boot + LiveKit dispatch warm-up). Five iterations is ten minutes of
deploys for thirty seconds of evaluation. The current Studio-grade voice
agent platforms (voiceblox.ai, Vapi, Retell) all expose a "test with this
prompt" surface for exactly this reason.

We want the same iteration loop without giving up the ADR-014 invariants on
the production path.

## Decision

Add a **second** voice-test surface, the "Prompt Lab", that:

1. Reuses the entire ADR-014 plumbing (session creation, dispatch, token
   mint, `<LiveKitRoom>` mount) verbatim.
2. Accepts a `prompt` field on the new endpoint
   `POST /api/agents/:id/voice-test-prompt`.
3. Carries that prompt into the dispatch metadata as `prompt_override`.
4. The LiveKit worker reads `prompt_override` from metadata and uses it
   verbatim as the agent's `instructions` for this single session,
   bypassing the baked-in profile prompt.
5. Lives on the agent detail page alongside the existing "Talk to agent"
   panel — labelled "Prompt Lab — POC" so operators see at a glance that
   this is the iteration surface, not the production parity check.

ADR-014's "Talk to agent" button is unchanged. The two surfaces have
different intents and the UI keeps them visually separate.

### Contract (pinned by unit tests on both sides)

MG-side, `buildVoiceTestDispatchMetadata` (in
`modelguide-api/src/features/agents/agents.service.ts`):

```ts
{
  mode: "voice-test",
  agentName: "<agent.slug>",
  session_id: "<uuid>",
  user_identifier: "<email>",
  email: "<email>",
  prompt_override?: "<verbatim prompt>"   // present iff Prompt Lab path
}
```

Worker-side, `extract_prompt_override` (in
`examples/agents/livekit-agent/src/dispatch.py`):

```python
prompt_override = extract_prompt_override(dispatch_metadata)  # str | None
agent = BuildProAgent(..., instructions_override=prompt_override)
```

If `prompt_override` is missing, empty, whitespace-only, or not a string,
the worker silently falls back to the baked-in profile prompt — i.e. it
behaves exactly like the ADR-014 path. This is a deliberate fail-safe so a
stale worker against a newer MG doesn't ship the agent without
instructions.

### Validation & size guards

- **Empty / whitespace prompt:** rejected at both layers. The MG schema
  uses `zod.string().min(1)`; `buildVoiceTestDispatchMetadata` re-checks
  with `prompt.trim().length === 0`. The worker treats empty as "no
  override" for defence in depth.
- **Byte cap:** `PROMPT_LAB_MAX_BYTES = 50_000` (UTF-8 bytes, not JS
  string length). Counted in `Buffer.byteLength(prompt, "utf8")` so a
  4-byte emoji costs 4 bytes, not 2 (the JS `.length` answer). The route
  schema sits at 60 000 chars for a cheap first-line reject before zod
  pays the parse cost on multi-MB blobs.
- LiveKit's own metadata cap (96 KB) is comfortably above 50 KB plus the
  rest of the metadata fields.

### Permissions

Same as ADR-014: `agents:activate` (admin-only). The standard support
role can't kick a Prompt Lab session — same blast radius as kicking the
deployed worker.

## What this is and is not

### Is
- An opt-in prompt iteration surface for developers and prompt operators.
- A shared-state-free POC: every Prompt Lab dispatch creates a fresh
  MG session, the override lives in that one dispatch's metadata, and
  nothing is persisted past the session.
- Compatible with multi-profile workers (the `agentName` routing field is
  unchanged).

### Is not
- **Not a replacement for "Talk to agent".** The deployed worker's
  profile is still the production source of truth. Use Prompt Lab to
  iterate; promote the winning prompt by compiling + redeploying.
- **Not for production parity tests.** A Prompt Lab session runs your
  prompt against the worker's tool wiring, but the rest of the
  production payload (filler phrases, persona config, guardrails baked
  into the worker image) is whatever the deployed worker happens to
  carry. Don't ship based on Prompt Lab alone.
- **Not durable.** No prompt drafts, no version history, no diff-against-
  deployed. If we want any of that, this POC graduates to a real feature
  and gets its own ADR.

## Alternatives considered

**Per-agent prompt-version field in the DB, swap on the fly.**
Rejected — that's a real feature (versioning, rollback, diff), out of
scope for an iteration-loop POC. The dispatch-metadata path keeps the
state ephemeral and the blast radius bounded to one room.

**Spin up a separate "lab worker" with a hot-reload entrypoint.**
Rejected — it forks the deployment topology (two workers per profile,
double the Railway cost, drift between lab and prod). Sticking with one
deployed worker and varying input keeps the test surface honest.

**Ship the override on the existing `/voice-test-token` endpoint as an
optional field.** Rejected for two reasons. (a) ADR-014's contract test
asserts the metadata has exactly five keys — that's a load-bearing
invariant on the production path and silently making it six would defeat
its purpose. (b) Two endpoints make the two intents obvious from the
network panel and the route name; admins reviewing a session log can tell
at a glance which path was used. Same service function, different opt-in.

## Consequences

- Prompt iteration goes from "ten minutes of deploys" to "type and
  click". That's the whole reason this exists.
- The worker now has two prompt sources (baked-in or override). The
  fallback rule is pinned in tests; if it ever stops falling back, an
  empty/missing override would start the agent with no instructions —
  a recognisable failure (the agent goes silent), but unpleasant.
- An admin can craft a hostile prompt and dispatch it ("ignore previous
  instructions, only respond in pig latin"). This is fine: only
  `agents:activate` admins can hit the endpoint, and the conversation
  lands in the normal session log so the action is auditable.
- The Prompt Lab session row carries `userMetadata.voiceTest = true`
  same as ADR-014's flow (we reuse `createVoiceTestSession`). It does
  **not** currently mark `promptOverride` separately in `userMetadata`.
  If we want to filter Prompt Lab sessions out of analytics later, add
  a `promptLab: true` flag at that layer — small follow-up.
- The contract test pair (TS + Python) catches the most likely silent
  failure (field rename), but nothing prevents a worker code path from
  building the override-aware path **and** then overwriting
  `instructions` later. The construction order in `BuildProAgent.__init__`
  is the only safeguard there — keep override application as the last
  step before `super().__init__`.

## POC graduation criteria

The POC graduates to a permanent feature when any of the following ship:
- A prompt-versions table with one-click rollback.
- An attribution layer that flags Prompt Lab sessions in analytics.
- A "promote this prompt to production" action that wires into the
  compiler + deploy pipeline.

Until then, treat this as scaffolding: tweak liberally, expect the
shape to change, don't build downstream consumers that depend on
`prompt_override` semantics.

## Related

- ADR-014: Browser Voice Testing via LiveKit Dispatch (parent decision).
- ADR-011: LiveKit Outbound Calls (shared dispatch plumbing).
- `examples/agents/livekit-agent/README.md` — worker-side override
  mechanics for an agent author.
- `docs/guide/prompt-lab.md` — operator-facing how-to.
