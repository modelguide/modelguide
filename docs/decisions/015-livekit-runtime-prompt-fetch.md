# ADR-015: LiveKit Runtime Prompt Fetch

**Status:** Proposed (POC)

## Context

ADR-014 shipped browser voice testing: from the agent detail page an admin can click **Voice Test** and start talking. The dispatch contract was deliberately narrow — it routes by slug, but the prompt itself comes from whatever the worker was packaged with.

Meanwhile the platform's **Compile** flow (compiler service in `modelguide-api/src/features/compiler/`) takes one or more SOPs + guardrails and writes a compiled prompt to `agents.compiled_instructions`. For the **ElevenLabs** platform we already push that prompt to the hosted agent inside `agents.sync.ts:syncAgentToElevenLabs` so a click-to-talk reflects the latest compile.

There is no equivalent path for **LiveKit**. Today, "Compile → Voice Test → Talk" mechanically works, but the conversation runs against whatever prompt the worker's `prompts/base.py` happens to contain. Operators discover this when they:

1. Edit a SOP.
2. Click **Compile** (success — `compiled_instructions` updated).
3. Click **Voice Test**.
4. Talk for 30 seconds and hear the *old* prompt's behavior.
5. File a bug.

The goal is to close that loop with the same iteration speed admins have on ElevenLabs: **the next call uses the prompt you just compiled, no worker redeploy**.

## Decision

The LiveKit worker fetches its system prompt from ModelGuide at the start of every job, via:

```
GET /api/agents/me/runtime-config
Authorization: Bearer mgk_<agent-key>
```

Response:

```jsonc
{
  "id":           "uuid",
  "slug":         "glowbox-voice",
  "name":         "GlowBox Voice",
  "modality":     "voice",
  "modelFamily":  "gpt",
  "instructions": "You are GlowBox …" | null,
  "compiledAt":   "2026-05-07T10:00:00Z" | null
}
```

The endpoint authenticates via the agent's API key (the same `mgk_…` already used for MCP). The bound agent is read from the auth context, so there's no path param — this stops a worker that holds key for *agent A* from accidentally pulling the prompt of *agent B*.

Worker-side precedence for the system prompt:

1. **Compiled prompt** from runtime-config — the dashboard is the source of truth.
2. **`DEFAULT_INSTRUCTIONS`** env var — local-dev escape hatch.
3. **Built-in fallback** so the worker always boots even if ModelGuide is unreachable on first run.

The dispatch contract (`buildVoiceTestDispatchMetadata`) gains a sixth field: `agentId`. The worker doesn't strictly need it for `/me/runtime-config` (the API key is already 1:1 with an agent), but downstream multi-profile workers may want to verify the dispatched agentId matches the one their key is scoped to.

The reference implementation lives in [`examples/agents/modelguide-voice-agent/`](../../examples/agents/modelguide-voice-agent/). It is intentionally smaller than the BuildPro Sam example — no MCP tools, no SIP, no tracing — so the prompt-fetch mechanism is easy to read and copy.

## Alternatives Considered

**Stamp the prompt into the worker image at deploy time.** Considered and rejected. CI builds are 60–120 s; that's the iteration cost an operator pays per prompt tweak. The whole reason "Voice Test" exists is to drive that cost to ~2 s.

**Inject the prompt into dispatch metadata.** Already considered and rejected in ADR-014:

> Earlier iterations shipped a `prompt_override` / `instructions_override` field in dispatch metadata so an admin could test a compiled prompt without redeploying the worker. We rejected this because the worker's profile is the authoritative source of prompt + tools. Injecting a different prompt creates a "it works in voice-test but broke in prod" failure mode.

This ADR doesn't undo that decision. We are *not* injecting a prompt-of-the-moment via metadata; we are giving the worker a way to pull the *same* compiled prompt it would use for any other call, on a fresh fetch. No drift.

**Fetch via MCP resource.** ModelGuide already has an MCP server (`modelguide-api/src/features/mcp/`). We could expose `mg://agent/runtime-config` as an MCP resource and let the worker read it that way. Rejected for the POC: MCP is the *agent-to-tools* boundary; runtime-config is *worker-to-platform*. Mixing the two would force every alternate worker stack (LangGraph, Mastra, …) to add an MCP client just to read a prompt. A boring HTTP GET is easier to lift into any stack.

**Cache + push (server pushes a webhook to all listening workers on compile).** A real solution for production at scale, where you want to swap prompts on every active call. Rejected for the POC because it requires the worker to expose an inbound endpoint and the platform to track active workers — out of scope for "talk to my prompt." A future ADR can layer this on top.

**Fetch on every turn, not just job-start.** Rejected. Prompts are stable within a single conversation; refetching mid-call adds latency on every user turn for no gain. Operators *expect* "Voice Test" to be a fresh session; if they want the new prompt, they hang up and click again.

## Consequences

- **Click → Compile → Voice Test → Talk** now reflects the just-compiled prompt within ~2 s of the click. Same iteration speed as the ElevenLabs sync flow.
- **The runtime-config endpoint becomes a load-bearing contract** between the API and any worker that uses it. Like the dispatch metadata in ADR-014, there's no shared schema across the TypeScript / Python boundary, so we lock the contract behind tests on both sides:
  - API: `tests/integration/agents.test.ts` — describes shape, auth, and the uncompiled-agent path.
  - Worker: `examples/agents/modelguide-voice-agent/tests/test_runtime_config.py` — exercises the fetch against `respx`.
- **One API key per worker per agent.** Because `/me/runtime-config` reads the bound agent from auth, multi-tenant workers (one process serving many agents) need either (a) a key registry keyed by dispatched `agentId`, or (b) an org-scoped key + a `/agents/:id/runtime-config` variant. We deferred that decision; the POC is one-key-one-agent.
- **First-boot UX:** if someone deploys the worker before clicking **Compile** even once, `instructions` is `null`. The agent doesn't crash — it falls back to `DEFAULT_INSTRUCTIONS` then to a baked-in apology prompt and tells the caller to compile a SOP first. This is a deliberately visible failure mode, not a silent one.
- **Failure mode if ModelGuide is unreachable:** worker logs a warning and boots with the env / built-in fallback. The agent will sound generic, but the call still connects — same posture as ADR-014's "no silent failures" rule.

## Out of Scope (future work)

- Pushing prompt updates into a live call.
- Multi-agent workers (one process, many keys).
- Including tool definitions in runtime-config so a single worker can serve different SOPs without redeploy. (Today the BuildPro example hard-codes `TOOL_NAMES`; a follow-up could move that into runtime-config too.)
- Versioning / pinning a compile so a long-running test conversation isn't disrupted by a re-compile mid-session.
