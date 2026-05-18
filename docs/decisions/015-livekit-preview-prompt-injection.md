# ADR-015: LiveKit Preview Voice (POC) — Prompt Injection for Iteration

**Status:** Accepted (POC)

## Context

The dashboard has an existing voice-test feature ([ADR-014](./014-browser-voice-testing.md)):
click "Talk to agent" on an agent's detail page and the configured LiveKit
worker is dispatched into a fresh room so you can talk to it via WebRTC. It
uses whatever prompt the worker already has baked into its profile.

ADR-014 explicitly **rejected** prompt injection: dispatching a different
prompt via metadata creates a "works in voice-test, broke in prod" failure
mode, because the worker's profile is the authoritative source of truth and
the deployed prompt could quietly diverge from the one you just tested.

That decision is right for **voice-test** (verifying the *deployed* agent
behaves correctly). It blocks a different workflow that operators have
been asking for:

> "I just edited a SOP and recompiled. I want to hear how the new prompt
>  sounds *before* I promote it onto the production worker."

Today that round-trip looks like:

1. Edit SOP → recompile.
2. Rebuild the worker image with the new compiled prompt baked in.
3. Re-deploy the worker to LiveKit Cloud.
4. Click "Talk to agent."
5. Realise the wording is awkward → back to step 1.

That's a 5–10 minute loop per iteration. For prompt tuning, where you
typically want 10–20 iterations to nail tone, that's an hour of
mechanical work for what should be conversational fiddling.

## Decision

Add a **preview-voice POC** that lives alongside voice-test. The preview
flow intentionally injects the compiled prompt into dispatch metadata so
the operator can hear an *un-deployed* prompt before promoting it.

### Three concrete pieces

1. **Endpoint** `POST /api/agents/:id/preview-voice-token` — sibling of
   `voice-test-token` with one extra body field:

   ```jsonc
   { "instructions": "<the compiled system prompt>" }
   ```

   - If `instructions` is provided, uses it.
   - If omitted, falls back to `agent.compiledInstructions` (so a power
     user can hit the endpoint without first re-typing what's already in
     the DB).
   - Errors `400` if both are missing.
   - Validates the prompt at ≤50K chars (Zod, route-level).

2. **Preview worker** at
   [`examples/agents/livekit-preview-agent/`](../../examples/agents/livekit-preview-agent/)
   — a minimal LiveKit worker registered under
   `env.LIVEKIT_PREVIEW_AGENT_NAME` (default `preview-worker`). It:

   - Parses dispatch metadata, expects `mode == "preview"`.
   - Reads `instructions_override`, uses it as the LLM system prompt.
   - Has no MCP, no tools, no profile registry. Preview is about hearing
     the *prompt*, not the surrounding orchestration.
   - Disconnects on dispatch that is not `mode: preview` (refuses to
     limp along with an empty prompt).

3. **UI** `PreviewVoicePanel` rendered inside the `CompiledPromptCard`
   under the agent's prompt-compiler tab. Adds a "Sync & Talk" button
   that posts the current `compiledInstructions` to the preview endpoint
   and joins the room via WebRTC.

### Dispatch contract

The TypeScript (`buildPreviewDispatchMetadata`) and Python
(`parse_dispatch_metadata`) sides are pinned to the same JSON shape via
pure-function unit tests:

```jsonc
{
  "mode": "preview",
  "agentName": "<mg-agent-slug>",
  "session_id": "<uuid>",
  "user_identifier": "<caller email>",
  "email": "<caller email>",
  "instructions_override": "<the compiled system prompt>"
}
```

- API contract test:
  `modelguide-api/tests/unit/agents/preview-voice-dispatch.test.ts`
- Worker contract test:
  `examples/agents/livekit-preview-agent/tests/test_dispatch.py`

Either side drifting silently breaks the feature, so the two test files
together are the contract.

### Why a *separate* worker, not the existing voice-test worker

Two distinct workers means two distinct concerns:

| Worker            | Dispatches when           | Prompt source                      |
| ----------------- | ------------------------- | ---------------------------------- |
| `livekit-agent`   | `voice-test`, `outbound`  | Baked into profile (immutable)     |
| `livekit-preview-agent` | `preview`           | Injected via dispatch metadata     |

The production worker stays uncontaminated by the injection code path. An
operator who clicks "Talk to agent" on a configured agent is guaranteed
to hear the deployed prompt — there is no metadata-driven fork inside
that worker that could accidentally fire and replace it. ADR-014's
"authoritative source of prompt" promise survives intact.

### Why this is OK to ship as a POC

The "works in test, broke in prod" hazard ADR-014 named is real for
voice-test (which is meant to verify the deployed agent). It does NOT
apply to preview, because preview is explicitly *not* claiming to test
the deployed agent — its whole point is to test something that is *not
yet* deployed. The drift the ADR worried about is the entire feature
here, deliberately exposed at a different workflow moment.

The operator's mental model is:

- "Talk to agent" → "Is the live agent working?" (voice-test)
- "Sync & Talk"   → "Does my draft prompt sound right?" (preview)

Two buttons, two workers, two endpoints. No overlap.

## Alternatives Considered

**Reuse the existing `livekit-agent` worker with a `mode: preview` branch.**
Rejected — it would put the metadata-injection code path into the production
worker. A regression in that branch could leak into voice-test or outbound
flows and silently override real prompts.

**Synthesize "preview" entirely client-side via WebRTC + browser LLM.**
Rejected for the POC — would diverge from the actual STT/LLM/TTS stack used
in production. The whole point of voice preview is to hear the same
pipeline the deployed agent uses. A different stack tells you nothing
about how the deployed agent will sound.

**Add a "dry-run worker" mode to the platform that polls compiled prompts
on dispatch.** Rejected as too heavy for a POC — adds a request from the
worker back to the API per dispatch (auth, RLS, latency), and the worker
needs a way to authenticate. Injecting via metadata is simpler and
self-contained.

**Use the existing `instructions_override` field design from the rejected
#234 / #239 PRs.** This *is* what we did. Those PRs were rejected on the
production worker; this ADR uses the same idea on a separate preview
worker where the drift hazard doesn't apply.

## Consequences

- Operators can iterate on prompts in minutes instead of redeploy
  cycles. End-to-end loop is: edit SOP → click Compile → click Sync &
  Talk → talk → repeat. No deploy step.
- The preview worker is a single-instance shared resource per LiveKit
  Cloud project. Concurrent previews under the same `AGENT_NAME` are
  serialised by the worker's job-capacity setting (LiveKit handles
  queuing). If preview becomes load-bearing, scale by running multiple
  preview workers with distinct names and routing via
  `metadata.livekit.previewAgentName`.
- The preview worker has **no MCP / no tools**. Tool-call regressions
  must still be caught by the eval suite (ADR-007 / ADR-009), not by
  talking to the preview. The "Preview Voice" panel surfaces the prompt
  length the API echoed back so operators can confirm the right prompt
  was injected.
- The preview session row is created normally (so transcripts and
  analytics show *something*), but with no MCP the worker doesn't emit
  `core_add_messages` calls — the transcript page will show a session
  with zero messages. Acceptable for a POC; revisit if preview is
  promoted to a permanent feature.
- The MG-agent-slug ↔ worker-profile-slug contract from ADR-014 does NOT
  apply here — the preview worker has no profile registry. It accepts
  any dispatch with `mode: preview`. The slug is still carried in
  metadata for log-correlation purposes, but routing is on the worker
  name (`AGENT_NAME`), not on the per-agent slug.
- One new env var: `LIVEKIT_PREVIEW_AGENT_NAME` (default
  `preview-worker`). Added to `env.ts` validation; needs to be reflected
  in `railway/DEPLOY.md` when the POC graduates beyond local testing.

## Known test gap

Same gap as ADR-014: there is no end-to-end integration test that
actually dispatches against a real LiveKit server. Mocking
`livekit-server-sdk` after the service has imported it doesn't propagate
reliably via Bun's `mock.module`. What's covered:

- **API contract** — `buildPreviewDispatchMetadata` (8 unit tests).
- **Worker contract** — `parse_dispatch_metadata` (9 unit tests in
  Python).
- **API error paths** — all 9 of: not configured (400), unauthenticated
  (401), cross-org (404), unknown agent (404), inactive (400), non-voice
  modality (400), non-livekit platform (400), wrong role (403), prompt
  over 50K (422), missing prompt with no fallback (400).
- **UI behaviour** — `PreviewVoicePanel` (6 component tests).

The happy path (dispatch + token mint + 201 response) is exercised by
the manual quick-start in `examples/agents/livekit-preview-agent/README.md`.

## Related

- [ADR-014: Browser Voice Testing via LiveKit Dispatch](./014-browser-voice-testing.md)
  — the existing voice-test flow this extends.
- [ADR-011: LiveKit Outbound Calls](./011-livekit-outbound-calls.md) —
  the original dispatch + token pattern both flows build on.
- [ADR-007: Evaluation Engine](./007-evaluation-engine.md) — where
  tool-call regressions get caught, since preview doesn't exercise them.
