# ADR-015: Runtime Prompt Fetch for Voice Test

**Status:** Accepted (POC)

## Context

ADR-014 shipped a one-click "Talk to agent" flow that dispatches the configured LiveKit worker into a fresh room. The worker uses whatever prompt was baked into its profile at deploy time. That's the right default for production traffic, but it leaves a gap for the iteration loop an operator actually has:

1. Edit a SOP in the dashboard.
2. Click **Compile prompt** (`POST /api/agents/:id/compile`) — the new system prompt lands in `agents.compiled_instructions`.
3. Click **Talk to agent** — and immediately hear yesterday's prompt, because the worker doesn't know the DB changed.

To close that loop the operator currently has to redeploy the worker (the path ADR-014 explicitly recommended: _"If you want to test a new prompt, build a new profile on the worker and dispatch to it."_). For a 10-minute prompt iteration that's a 5-minute round-trip and zero developer joy.

[voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) ships an equivalent loop end-to-end: edit prompt → click test → talk. We want the same thing inside ModelGuide.

## Decision

When the voice-test dispatcher kicks off a room, it now passes the **MG agent UUID** (`mg_agent_id`) in dispatch metadata alongside the existing `agentName` slug. The LiveKit worker — at room-join time — calls `GET /api/agents/:id` and reads `compiledInstructions`. That string is used as the agent's system prompt for the call. If the fetch fails or the field is empty, the worker silently falls back to its baked-in profile prompt.

Mechanically:

- **API**: `buildVoiceTestDispatchMetadata` adds `mg_agent_id`. `createVoiceTestSession` populates it from the agent record before dispatching. No new endpoint, no new env vars.
- **Worker**: `runtime_prompt_agent.py` defines `RuntimePromptAgent` (a thin subclass of `BuildProAgent` whose constructor takes an explicit `instructions` argument) and `select_agent_class(dispatch_metadata)` (picks the agent class based on metadata). The entrypoint in `agent.py` calls `select_agent_class` and, for voice-test rooms, fetches `compiledInstructions` via `mg_client.fetch_compiled_instructions(agent_id)` before constructing the agent.
- **UI**: the Voice Test panel surfaces a small "Last compiled `<timestamp>`" indicator so the operator can see _which_ prompt the worker is about to load. If the agent has no compiled prompt, the indicator flips to a warning that the baked-in fallback will run instead.

### Why fetch rather than inject

ADR-014 considered (and rejected) shipping the prompt itself inside dispatch metadata. Those reasons still hold:

| ADR-014 concern | How this ADR sidesteps it |
|---|---|
| 48KB metadata cap forces byte-size guards | We send a UUID, not the prompt |
| "Works in voice-test, broken in prod" drift | The prompt is the production prompt — same DB row the next prod sync will read |
| Implicit override is hard to audit | Fetch is logged with `agent_id`, prompt length, and session id |

The new wrinkle is the read coupling: a voice-test room now makes a synchronous REST call to MG on connect. We accept that cost (~50 ms LAN, ~200 ms WAN) because it happens during the WebRTC handshake window the operator is already waiting through.

### What this does NOT do

- **Production traffic is unchanged.** `select_agent_class` only swaps in `RuntimePromptAgent` when both `mode == "voice-test"` _and_ `mg_agent_id` are set. SIP calls, direct `lk dispatch`, and dashboard "outbound call" all keep using `BuildProAgent` with the baked-in prompt.
- **No long-running cache.** Each voice-test fetches fresh — if the operator clicks Compile twice and Test once, the second click reflects the most recent compile. That's the whole point of the loop.
- **No prompt versioning UI in this POC.** The indicator shows `compiledAt`; the operator picks what they trust. A future ADR can add explicit version pinning if "test against a known-good prompt" becomes a workflow.
- **No tool surface change.** `RuntimePromptAgent` inherits BuildPro's tools verbatim. This POC is about which prompt the LLM sees, not which tools it can call. A scenario-specific runtime agent (different connectors, different guardrails) is a separate piece of work.

## Alternatives Considered

**Inject the prompt in dispatch metadata.** Rejected for the reasons in ADR-014: byte-size cap, drift, and harder audit. Passing an ID and fetching keeps the DB row authoritative.

**Recompile inside the voice-test endpoint.** Rejected — coupling compile (which is `agents:update`) to voice-test (`agents:activate`) widens the permission for operators who shouldn't be editing the prompt. Compile stays its own action.

**Have the worker poll for changes between calls.** Rejected — adds permanent load for a flow that only matters during a manual iteration session, and complicates the cache invalidation story. Per-dispatch fetch is the right shape for the load profile (~1 per click).

**Ship a separate "voice-test" worker that's always rebuilt with the latest prompt.** Rejected — that's literally the workflow this ADR exists to remove. A separate worker also doubles the LiveKit cloud spend for what should be an in-place behavior.

## Consequences

- **Tightens the iteration loop from minutes to seconds.** Compile → Test → talk now reflects the just-compiled prompt without a redeploy.
- **Adds one REST call per voice-test dispatch.** The call is small (single `GET /api/agents/:id`), executes inside the worker's existing aiohttp pool, and runs in parallel with `wait_for_participant`. If it fails or times out, the worker logs and falls back — the voice test still succeeds.
- **ADR-014's "no prompt injection" stance is partially superseded.** Specifically: we now do allow the worker to use a prompt other than its baked-in one during voice-test. ADR-014's reasons against _metadata-borne_ injection still hold (size, drift), and this ADR honours them by passing a reference rather than the prompt itself.
- **The MG-agent-slug ↔ worker-profile-slug coupling from ADR-014 remains.** `agentName` still routes the dispatch to the right worker profile inside a multi-profile worker. The runtime prompt then overlays on top of whatever tools that profile provides.
- **Operators can now talk to a prompt that was never reviewed.** This was already implicitly true for compile-on-dev, but it's worth flagging: voice-test is admin-only (`agents:activate`) and operates on the operator's own org. There's no cross-org exposure path.

## Implementation Notes (POC)

- `buildVoiceTestDispatchMetadata` adds `mg_agent_id`. Locked by `tests/unit/agents/voice-test-dispatch.test.ts` so a refactor that renames or drops the field surfaces in CI immediately.
- `mg_client.fetch_compiled_instructions` is exception-swallowing on purpose. Voice-test is a UX path — failing the dispatch because the API blipped would hide the actual feature behind error states. All failures are logged with `agent_id` for triage.
- The UI indicator reads `agent.compiledAt` from the existing agent payload — no new endpoint, no extra round-trip.

## Related

- **ADR-014** — Browser voice testing. This ADR extends it and supersedes the "No prompt injection" subsection (with the qualification that we still don't inject the prompt itself in metadata).
- **ADR-011** — LiveKit outbound calls. Unchanged. Outbound dispatches don't carry `mode: "voice-test"` so they go through the existing BuildProAgent path.
- **ADR-005** — SOPs as core primitive. The compile step that produces `compiledInstructions` is the same one this ADR makes round-trip-testable.

## Known Limitations

- The POC swaps the entire system prompt, not the tool set. A prompt that references tools the worker doesn't have will get tool-call errors at runtime. This matches production behavior today (a prompt with bad tool names will fail regardless of how it got there) but is worth flagging if anyone tries to "test a different agent persona" through this flow.
- `compiledInstructions` is the only field overlaid. Other agent-config fields (LLM model, voice ID, STT model) still come from the worker's profile config. This is intentional — the operator's edit loop is overwhelmingly about prompt text.
- No structured E2E test against a real LiveKit server (same constraint as ADR-014). Coverage is: unit test on the dispatch metadata shape, unit test on the fetch helper's success / null / empty / error paths, unit test on `select_agent_class`, and a UI test on the new indicator.
