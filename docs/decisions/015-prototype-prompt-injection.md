# ADR-015: Prototype LiveKit Voice Test via Prompt Injection

**Status:** Accepted (POC)

## Context

[ADR-014](./014-browser-voice-testing.md) added the production Voice Test
panel: click a button on an agent detail page and talk to the deployed
LiveKit worker. That ADR explicitly **rejected** prompt injection — the
worker's profile is the authoritative source of prompt + tools, and shipping
a different prompt in dispatch metadata creates an "it works in voice-test
but broke in prod" failure mode.

That trade-off is the right one for the production button. It doesn't fit
the prompt-iteration workflow:

- The author edits a SOP, recompiles the prompt, and wants to **hear** the
  new text immediately. With ADR-014 they have to redeploy the worker first,
  which is slow and out of band of a normal SOP edit.
- The friction discourages tight iteration. People write the prompt blind
  and only listen to it once it's been deployed.

[voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) (the
inspiration for this POC) and the company's `~/Project/modelguide/website`
test page both accept the drift trade-off in exchange for a one-click
"compile → talk" loop. We're carving out the same loop in the dashboard,
explicitly bounded to a **prototype** worker.

## Decision

Add a parallel flow that injects the compiled prompt into dispatch metadata
and dispatches a different worker that uses the metadata as its system
prompt:

- `POST /api/agents/:id/prototype-voice-test-token` — same shape as
  `voice-test-token` plus `instructionsHash` + `instructionsLength` fields,
  guarded by `agents:activate`.
- `buildPrototypeDispatchMetadata` (pure helper, unit-tested) constructs the
  payload `{ mode, agentName, session_id, user_identifier, email,
  instructions }`. **Refuses** to build a payload with empty `instructions`.
- `createPrototypeVoiceTestSession` requires `compiledInstructions` to be
  non-empty on the agent row. Returns 400 if the agent hasn't been compiled.
- A new minimal Python worker, `examples/agents/livekit-prototype/`, reads
  `dispatch_metadata["instructions"]` and uses it as the `Agent(instructions=…)`
  prompt. No tools, no MCP, no SOPs — just prompt-driven voice.
- The dashboard's `PrototypeVoiceTestPanel` runs the loop in one click:
  1. mic-permission probe,
  2. `POST /agents/:id/compile` (the **Sync** half — guarantees the worker
     dispatches with the freshest text),
  3. `POST /agents/:id/prototype-voice-test-token`,
  4. mounts `<LiveKitRoom>` and joins the room.

This sits **alongside** the production Voice Test panel — not as a
replacement. The production panel stays the right pre-ship check.

### Worker selection

The agent's `metadata.livekit.agentName` decides which LiveKit worker the
dispatch lands on. Operators point a prototype-flavoured agent record at the
prototype worker (`PROTOTYPE_AGENT_NAME` env, default
`modelguide-prototype`) and the production agent record at the production
worker. A single org can have both side by side.

### Cross-language contract

`buildPrototypeDispatchMetadata` (TypeScript) and
`prototype_agent.metadata.parse_dispatch_metadata` (Python) are coupled by a
JSON shape with no shared type system. **Both sides** have unit tests on the
field names, presence, and validation rules, and the README's wire-contract
table cross-links them. If a field renames silently on one side, the test on
the other side breaks loudly.

### Error taxonomy

| Status | Condition |
|---|---|
| 400 | agent not active; modality ≠ voice; platform ≠ livekit; LiveKit URL/agentName missing; LiveKit secrets missing; **`compiledInstructions` empty** |
| 401 | unauthenticated |
| 403 | authenticated but lacks `agents:activate` |
| 404 | agent doesn't exist or belongs to a different org |
| 500 | LiveKit dispatch or token mint failed (session rolled to `abandoned`) |

## Trade-offs we're explicitly accepting

ADR-014 listed these as reasons to **not** inject a prompt. We accept all
three, scoped to the prototype path:

1. **Drift between voice-test and prod.** What you hear with the prototype
   panel is **not** what callers will hear from the deployed worker. The
   prototype worker has no tools, no MCP, no SOP-step routing. The fix is
   social: name the panel "Prototype Voice Test" and document it as a
   prompt-iteration aid, not a pre-ship check.
2. **Metadata size.** LiveKit dispatch metadata caps at ~48KB. Compiled
   prompts can be large. We don't add a guard yet — if a prompt overflows,
   LiveKit's dispatch call returns an error and the existing rollback
   abandons the session. If this becomes routine, add a 50K-char cap on the
   API side (see ADR-014's rejected-alternatives rationale).
3. **Two worker images.** A team running both the production and prototype
   flow needs two deployments. Worth it for the dev-loop speedup.

## Alternatives considered

**Add a "test mode" flag to the production worker.** Rejected. The
production worker is multi-profile, MCP-wired, SOP-aware. Forking its
behaviour on a metadata flag invites the very drift that made ADR-014
reject prompt injection in the first place — except now in production code.

**Mint a token client-side and connect the browser straight to a
self-hosted LiveKit Meet.** Rejected. Same issue as ADR-014: shipping the
LiveKit secret to the browser, plus no MG session tracking.

**Run the prototype agent process in-browser via WebRTC.** Rejected. STT +
TTS in the browser are quality compromises, and the dispatch-and-deploy
shape is what we actually want to test (it's the failure surface ops cares
about).

## Consequences

- Sub-second iteration loop on prompt edits during development. Edit prompt
  → click → talk.
- Two LiveKit workers to deploy for an org that wants both. Documented in
  the prototype README.
- A second cross-language contract between TS API and Python worker.
  Mitigated by symmetric unit tests.
- ADR-014's rejection of prompt injection still applies to the production
  voice-test path. This ADR is scoped to the prototype path only.

## Test coverage

- Pure helper: 8 unit tests in
  `modelguide-api/tests/unit/agents/prototype-voice-test-dispatch.test.ts`
  (locks shape + field names + validation).
- Endpoint: 7 integration tests in
  `modelguide-api/tests/integration/agents.test.ts` (each error path:
  401, 403, 404 unknown, 404 cross-org, 400 inactive, 400 non-livekit, 400
  non-voice, 400 missing compiled prompt).
- Python worker contract: 11 unit tests in
  `examples/agents/livekit-prototype/tests/test_metadata.py` (happy path +
  bad JSON + missing required fields + whitespace + fallback paths).
- UI: 5 unit tests in
  `modelguide-ui/src/features/agents/components/prototype-voice-test-panel.test.tsx`
  (renders for LiveKit only, gates on `livekitConfigured`, gates on
  `canMutate`, **compile-then-dispatch order**, mic-denial path).

## Related

- ADR-011: LiveKit Outbound Calls — the dispatch primitive both flows share.
- ADR-014: Browser Voice Testing — the production flow that this prototype
  pairs with (and that this ADR's "what about drift?" trade-off references).
- voiceblox-ai/voiceblox — design inspiration for the dev-loop UX.
- `examples/agents/livekit-prototype/README.md` — runbook for deploying the
  prototype worker.
