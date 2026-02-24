# SOP Simulation System and Audience Simulation

> **Scope:** This document covers the SOP concept, evaluation engine, audience simulation, manager onboarding flow, domain expert feedback loop, and advanced evaluation capabilities (pass-k testing, judge calibration, sandboxing, error taxonomy, production-to-simulation loop, voice metrics, binary scoring).

---


## 1. TLDR: SOP + Audience Simulation = Fast Onboarding

By combining **SOPs** (machine-readable "golden path" definitions) with **Audience Simulation** (LLM-driven synthetic customers), ModelGuide lets a Manager validate AI Agent behavior for a specific project **before going live** — no real customer traffic needed.

ModelGuide provides the Manager with three adjustable levers:

| Lever | What it controls | Ships as template? |
|---|---|---|
| **SOP** | What the agent should do — which tools to call, in what order, with what checks | Yes — global SOP templates per connector type |
| **Persona** | How the simulated customer behaves — tone, patience, cooperativeness | Yes — polite, impatient, adversarial built-in |
| **Agent** | The AI agent's system prompt, model, and connected tools | Configured per org |

The Manager adjusts these levers and runs a simulation. The system drives a realistic conversation between the Persona and the Agent through real MCP tools, then auto-evaluates the resulting session against the SOP. The full cycle takes under one hour:

```
Write/Adjust SOP (30 min) → Run Simulation (5 min) → See Compliance Result (instant)
```

This tight loop works for initial SOP authoring, agent prompt tuning, regression testing before model upgrades, and stress-testing with adversarial personas — all before a single real customer interacts with the agent.

---

An **SOP (Standard Operating Procedure)** is a declarative description of the "golden path" for a specific customer interaction scenario. It captures what an AI agent SHOULD do — which tools to call, in what order, with what preconditions — and provides a machine-readable way to verify whether a completed session followed that path.

SOPs serve four purposes:

1. **Agent behavioral contract** — The SOP is the single source of truth for agent behavior. Agent infrastructure (ElevenLabs, Mastra, Pipecat, etc.) consumes the SOP to drive runtime behavior — as prompts, guardrails, and knowledge (see §2.4).
2. **Post-session evaluation** — Match applicable SOPs against a completed session transcript, verify each step, produce a compliance score.
3. **Operational visibility** — Dashboard metrics on pass rates, failing steps, and coverage give admins actionable insight into agent quality.
4. **Fast project onboarding** — SOP combined with Audience Simulation lets a Manager onboard a new project and verify the AI Agent will behave according to SOP before any real customer interaction.

---

## 2. SOP Structure

Every SOP is a self-contained evaluation unit with five parts: **trigger** (when does this SOP apply?), **steps** (ordered evaluation checkpoints), **scoring** (how to aggregate results), **onFail** (what happens on failure), and **metadata** (classification for filtering).

### 2.1 Lifecycle: Template → Definition → Eval Run

Mirrors the existing `connectors_catalog → connectors` two-tier model:

| Layer | Scope | Purpose |
|---|---|---|
| **SOP Template** | Global | Reusable blueprint, tied to a connector catalog type. E.g. "Ticket Escalation" for any Zendesk connector — works for GlowBox, ClearHealth, and SteelPoint. Authored by platform maintainers. |
| **SOP Definition** | Org-scoped | Instantiated from a template (or authored from scratch). Bound to specific connectors via `connectorBindings`. Optionally scoped to a single agent. Orgs can customize steps, weights, thresholds. |
| **SOP Eval Run** | Org-scoped | Result of evaluating one SOP against one completed session. Stores per-step pass/fail, overall score, and trigger source. |

### 2.2 Anatomy of a Step

Each step is a single assertion about the session. It answers one question: "Did the agent do X correctly?"

A step has:
- **id** — unique key within the SOP (e.g. `"verify-identity"`)
- **label** — human-readable description of the expectation
- **evaluator** — the check to run (one of 7 types, see [section 5](#5-the-7-evaluator-types))
- **weight** — relative importance for weighted scoring (0.0–1.0, all weights sum to 1.0)
- **required** — if `true`, failing this step can hard-fail the entire SOP
- **onFail** — optional action when this specific step fails (`warn`, `reject`, `escalate`)

### 2.3 Step Ordering Semantics

Steps are evaluated in declaration order, but they do NOT represent a strict sequential timeline. A step can check something that happened at the beginning of the conversation (e.g., identity verification) or something that spans the entire session (e.g., "agent never revealed other customers' data"). The ordering matters for readability and for short-circuit behavior (a failed `required` step with `onFail.action = "reject"` stops evaluation).

### 2.4 SOP as Agent Source of Truth

SOPs are not only used for post-session evaluation. They are also the **source of truth for agents themselves**. The SOP defines **what** the agent should do; the agent infrastructure determines **how** the SOP is consumed.

| Agent Platform | How SOP is Consumed | Example |
|---|---|---|
| **ElevenLabs** (voice) | SOP injected into system prompt as behavioral instructions | Voice agent uses SOP steps as conversational guardrails |
| **Mastra** (orchestrator) | SOP parsed into workflow nodes and tool-call sequences | Agent framework enforces step ordering programmatically |
| **Pipecat** (pipeline) | SOP extracted into pipeline stage configuration | Each SOP step maps to a pipeline processing stage |
| **Custom / direct LLM** | SOP text included in system prompt verbatim or as structured rules | LLM follows SOP steps as part of its instruction context |

This means changes to an SOP have **dual impact** — they change both how the agent behaves (runtime) and how the agent is evaluated (post-session). The simulation loop (§7) tests both simultaneously: the same SOP that instructs the agent is the same SOP that evaluates the resulting session.

![System Architecture, SOP Definition Anatomy, Evaluation Flow, and 7 Evaluator Types](./sop_4.png)
*Left: System architecture showing global catalog → org-scoped definitions → runtime evaluation. Center: SOP definition anatomy (trigger, steps[], scoring, onFail, metadata). Right: 6-step evaluation flow. Bottom: The 7 evaluator types.*

---

## 3. System Integration

### 3.1 Where SOPs Sit in the Architecture

SOPs connect three existing platform concepts:

- **Connectors Catalog / Connectors** — define which tools exist and how they're named
- **Agents** — run sessions via MCP, produce the tool calls and messages that SOPs evaluate
- **Sessions / Session Messages** — the raw trace data that SOPs evaluate against

The architecture diagram above (left panel of `sop_4.png`) shows the full data flow: global catalogs (SOP templates, connectors catalog, persona templates) instantiate into org-scoped definitions, which produce runtime artifacts (eval runs, sessions, simulation runs).

### 3.2 Evaluation Trigger Points

SOP evaluation runs **after** a session reaches terminal status (`completed` or `abandoned`). Three trigger modes:

| Trigger Source | When | How |
|---|---|---|
| **Automatic** | Session status changes to terminal | Event-driven (session completion hook) |
| **Manual** | Admin clicks "Evaluate" in dashboard | `POST /api/evals/runs/trigger` with session ID |
| **Batch** | Scheduled or on-demand for historical sessions | Cron job or admin bulk action (future) |

### 3.3 Evaluation Flow

The evaluation flow (right panel of `sop_4.png`) executes in 6 steps:

1. **Session completes** — status changes to `completed`
2. **Load active SOP definitions** for the org (filtered by agent_id if set, or org-wide)
3. **Trigger matching** — evaluate each SOP's trigger against session data (channel type, tool call log, user message text)
4. **Evaluate each step** — resolve tool references via connectorBindings, run the step's evaluator, record pass/fail. If step is required + failed + onFail=reject → short-circuit.
5. **Compute overall score** — using scoring mode (weighted sum or all-required binary)
6. **Write eval run** — to `sop_eval_runs` table with step_results

### 3.4 Tool Name Resolution

SOPs store **bare tool slugs** (e.g., `get_order`) to stay portable across orgs. At eval time, the `connectorBindings` on the SOP definition map catalog slugs to connector instance UUIDs, which resolve to the full MCP tool name:

```
SOP step: toolSlug = "get_order"
         │
connectorBindings: { "medusa": "<connector-uuid>" }
         │
Connector row: slug = "glowbox_store"
         │
Resolved MCP name: "glowbox_store_get_order"
         │
Match against session_messages WHERE toolName = "glowbox_store_get_order"
```

For multi-connector SOPs (e.g., Medusa + Zendesk), each step specifies `catalogSlug` to disambiguate:

```
{ toolSlug: "get_order", catalogSlug: "medusa" }     → glowbox_store_get_order
{ toolSlug: "create_ticket", catalogSlug: "zendesk" } → glowbox_support_create_ticket
```

Resolution examples across all three verticals:

| Vertical | Catalog | Connector Slug | Example Resolution |
|---|---|---|---|
| GlowBox Beauty | medusa | `glowbox_store` | `glowbox_store_get_order` |
| GlowBox Beauty | zendesk | `glowbox_support` | `glowbox_support_create_ticket` |
| ClearHealth | medusa | `clearhealth_pharmacy` | `clearhealth_pharmacy_get_order` |
| ClearHealth | zendesk | `clearhealth_support` | `clearhealth_support_get_ticket` |
| SteelPoint Supply | medusa | `steelpoint_catalog` | `steelpoint_catalog_list_products` |
| SteelPoint Supply | zendesk | `steelpoint_support` | `steelpoint_support_update_ticket` |

#### SOP Portability and Template Scope

SOPs are portable only at the **global template level**. An SOP template (e.g., "Order Lookup" in `sop_templates`) is connector-catalog-scoped, not connector-instance-scoped. This is what makes templates reusable across orgs.

When a template is **instantiated** into an org-scoped SOP definition, it is bound to specific connectors via `connectorBindings`. At that point, the definition contains org-specific tool references. There is **no cross-org SOP definition sharing** at this stage.

```
Global: sop_templates (portable, catalog-scoped, bare slugs)
         │
         ├─ instantiate for Org A → sop_definitions (connectorBindings → Org A connectors)
         ├─ instantiate for Org B → sop_definitions (connectorBindings → Org B connectors)
         └─ instantiate for Org C → sop_definitions (connectorBindings → Org C connectors)

Cross-org sharing happens at template level only.
Definition-level sharing: not supported (future RBAC consideration).
```

**Future consideration:** Templates may gain RBAC and cross-org sharing (e.g., a franchise sharing SOP templates across child orgs). However, when an SOP is created from a template, it is always converted into org-specific connector tools — the template provides the structure, the org provides the bindings.


## 4. Input Parameters — What Feeds Into SOP Evaluation

When an SOP is evaluated against a session, the evaluator has access to the following data:

### 4.1 Session Transcript

The primary input. All `session_messages` rows for the session, ordered by `occurredAt`:

| Field | Type | Used By |
|---|---|---|
| `role` | `"user" \| "assistant" \| "system" \| "tool"` | All evaluators (conversation context) |
| `content` | text | `llm_judge`, `confirmation_requested`, trigger `intent_detected` |
| `toolName` | varchar | `tool_called`, `tool_sequence`, `no_tool_called`, `tool_input_contains`, `tool_output_contains`, `confirmation_requested` |
| `toolInput` | JSONB | `tool_input_contains` |
| `toolOutput` | JSONB | `tool_output_contains` |
| `toolCallId` | varchar | Correlating tool request → response |
| `toolCallStatus` | varchar | `tool_called`, `tool_sequence`, `tool_input_contains`, `tool_output_contains` — distinguishes successful vs failed tool invocations |
| `createdAt` / `occurredAt` | timestamp | Ordering, turn computation |

### 4.2 Session Metadata

From the `sessions` table:

| Field | Type | Used By |
|---|---|---|
| `channelType` | `"voice" \| "chat"` | Communication medium. Trigger `{ type: "channel" }`. Orthogonal to `mode`. |
| `mode` | `"live" \| "simulation" \| "seed" \| "test-run"` | Traffic origin — filters dashboard views, gates evaluation pipelines. Default: `"live"`. |
| `agentId` | UUID | SOP definition scoping (agent-specific vs org-wide) |
| `status` | `"completed" \| "abandoned"` | Gating — only terminal sessions get evaluated |
| `userIdentifier` | varchar | Context for `llm_judge` |
| `userMetadata` | JSONB | Context for `llm_judge` |
| `startedAt` / `endedAt` | timestamp | Duration metrics |

### 4.3 SOP Definition Context

From the `sop_definitions` row being evaluated:

| Field | Type | Purpose |
|---|---|---|
| `connectorBindings` | JSONB `{ catalogSlug: connectorId }` | Resolves bare tool slugs to full MCP names |
| `definition` | JSONB (SopDefinition) | The trigger, steps, scoring config, and onFail action |
| `agentId` | UUID or null | Whether this SOP is agent-specific or org-wide |

### 4.4 Connector Context (Resolved at Eval Time)

For each connector referenced in `connectorBindings`:

| Field | Source | Purpose |
|---|---|---|
| `connector.slug` | `connectors` table | Tool name prefix (e.g. `"glowbox_store"`) |
| `catalog.slug` | `connectors_catalog` table | Maps to `catalogSlug` in step evaluators |
| Tool list | `connector_tools` table | Validates that referenced tools exist |

### 4.5 Summary: Evaluator → Input Data Matrix

| Evaluator Type | Session Messages | Tool Calls | Tool Call Status | Tool I/O | Channel | Transcript Text | LLM Call |
|---|---|---|---|---|---|---|---|
| `tool_called` | | X | X | | | | |
| `tool_sequence` | | X | X | | | | |
| `tool_input_contains` | | X | X | X (input) | | | |
| `tool_output_contains` | | X | X | X (output) | | | |
| `no_tool_called` | | X | | | | | |
| `confirmation_requested` | X | X | | | | X | |
| `llm_judge` | X | X | X | X | X | X | X |

### 4.6 LLM Judge: Common vs Custom Criteria

The `llm_judge` evaluator supports two categories of criteria:

| Category | Scope | Authored By | Example |
|---|---|---|---|
| **Common (built-in)** | Platform-wide, shipped as pre-configured evaluator step templates | Platform maintainers | "Was the agent following brand/company policies?", "Was the agent professional and courteous?", "Did the agent avoid sharing other customers' data?" |
| **Custom (per-SOP)** | Org-specific, defined within individual SOP steps | Org managers/admins | "Agent verifies customer identity before accessing account", "Agent explains refund timeline in plain language" |

**Built-in criteria** ship as pre-configured evaluator step templates. An org can include them in any SOP definition by referencing the template step. They are maintained centrally and updated across all orgs.

**Custom criteria** are freeform `criterion` strings written by the org manager for domain-specific checks. They follow the best practices described in section 5.2 (`llm_judge`).

Both categories use the same `llm_judge` evaluator type at runtime — the distinction is authorship and scope, not execution mechanics.

### 4.7 Trace Sources

SOP evaluation is source-agnostic — evaluators process `session_messages` rows regardless of how the session was generated. Three sources produce these traces:

| Property | Simulated | Seed-Generated | Production |
|---|---|---|---|
| **Generation method** | Orchestrator drives agent LLM ↔ user-simulator LLM through real MCP | `session-generator.ts` templates with fixed tool-call sequences | Real customer conversations via live channels |
| **Has real tool calls?** | Yes — agent calls tools via MCP, real connector responses | Synthetic — template-generated payloads (realistic but deterministic) | Yes — real tool calls against live connectors |
| **Realism** | High (LLM dynamics, varied phrasing) | Medium (realistic data, fixed flow) | Gold standard |
| **When to use** | SOP authoring, pre-launch validation, regression testing | Demos, fresh org seed data, evaluator unit testing | Ongoing monitoring, compliance reporting |
| **Mode field** | `mode = "simulation"` | `mode = "seed"` | `mode = "live"` (default) |

All three sources write to the same `session_messages` table. The SOP evaluator pipeline does not inspect `mode` — the trace is the trace. The `mode` field exists for filtering in the dashboard (e.g., "show only production compliance scores") and for cost attribution.

For new organizations, the typical progression is: **seed-generated** (instant, at org creation) → **simulated** (manager-driven, during SOP authoring) → **production** (real traffic, after go-live).

---

## 5. The 7 Evaluator Types

Each evaluator answers a specific class of question about agent behavior. Choose based on what you're checking (see the evaluator types panel in the bottom-center of `sop_4.png` above).

### 5.1 Decision Tree: Which Evaluator to Use

```
What are you checking?
│
├─ "Did the agent call a specific tool?"
│   └─ tool_called
│
├─ "Did the agent call tools in the right order?"
│   └─ tool_sequence
│
├─ "Did the agent pass correct inputs to a tool?"
│   └─ tool_input_contains
│
├─ "Did the tool return expected data / state?"
│   └─ tool_output_contains
│
├─ "Did the agent avoid calling forbidden tools?"
│   └─ no_tool_called
│
├─ "Did the agent ask for confirmation before a mutation?"
│   └─ confirmation_requested
│
└─ "Anything else (tone, policy, reasoning, judgment)?"
    └─ llm_judge
```

### 5.2 Evaluator Reference

#### `tool_called` — Was a specific tool invoked?

**Use when:** You need to verify the agent used a particular tool at any point during the session.

```typescript
{
  type: "tool_called";
  toolSlug: string;         // bare slug, e.g. "get_order"
  catalogSlug?: string;     // for multi-connector SOPs
}
```

**How it works:** Scans session tool call log for at least one call matching the resolved tool name.

**Cost:** Zero (pure log scan). Use this as the default when you just need to confirm tool usage.

---

#### `tool_sequence` — Were tools called in the right order?

**Use when:** The procedure requires tools to be called in a specific sequence (e.g., lookup before modify).

```typescript
{
  type: "tool_sequence";
  sequence: string[];       // ["get_order", "set_delivery_address"]
  contiguous: boolean;      // false = other tools allowed between
  catalogSlug?: string;
}
```

**How it works:** Walks the tool call log checking that tools appear in order. Supports `|` alternatives: `"get_order|look_up_order"` matches either.

**Cost:** Zero (log scan). Prefer this over multiple `tool_called` steps when order matters.

---

#### `tool_input_contains` — Did the tool receive correct input?

**Use when:** You need to verify the agent passed specific parameters to a tool (e.g., correct order ID format, required fields present).

```typescript
{
  type: "tool_input_contains";
  toolSlug: string;
  catalogSlug?: string;
  assertions: Record<string, InputAssertion>;
}

type InputAssertion =
  | { op: "exists" }                              // field is present
  | { op: "equals"; value: string | number | boolean }
  | { op: "matches"; pattern: string }            // regex
  | { op: "gt"; value: number }
  | { op: "lt"; value: number };
```

**Cost:** Zero (log scan + assertion check).

---

#### `tool_output_contains` — Did the tool return expected data?

**Use when:** You need to verify pre-conditions based on tool output (e.g., order status is not "shipped" before allowing modification).

```typescript
{
  type: "tool_output_contains";
  toolSlug: string;
  catalogSlug?: string;
  assertions: Record<string, OutputAssertion>;
}

type OutputAssertion =
  | { op: "exists" }
  | { op: "equals"; value: string | number | boolean }
  | { op: "contains"; value: string }
  | { op: "not_in"; values: string[] };
```

**Cost:** Zero (log scan + assertion check).

---

#### `no_tool_called` — Were forbidden tools avoided?

**Use when:** The agent must NOT call certain tools in this scenario (e.g., no direct refund processing for high-value orders).

```typescript
{
  type: "no_tool_called";
  toolSlugs: string[];      // ["complete_cart"] — these must NOT appear
  catalogSlug?: string;
}
```

**Cost:** Zero (negative log scan).

---

#### `confirmation_requested` — Did the agent ask before mutating?

**Use when:** A mutation tool (e.g., `set_delivery_address`) requires the agent to ask the customer for confirmation first.

```typescript
{
  type: "confirmation_requested";
  beforeToolSlug: string;   // the mutation tool
  catalogSlug?: string;
  pattern: string;           // regex matching confirmation language
  withinLastNTurns?: number; // how far back to look (default: 4)
}
```

**How it works:** Finds the tool call in the log, then looks at preceding assistant messages (within the turn window) for a regex match against confirmation language.

**Cost:** Zero (log scan + regex).

---

#### `llm_judge` — LLM-evaluated natural-language criterion

**Use when:** The check cannot be expressed as a tool log assertion — tone, policy adherence, reasoning quality, behavioral requirements.

```typescript
{
  type: "llm_judge";
  criterion: string;        // "Agent verifies customer identity before accessing account"
  model?: string;           // override default judge model
  rubric?: string;          // detailed rubric for nuanced evaluation
}
```

**How it works:** Sends the full conversation transcript + criterion (+ optional rubric) to an LLM judge. Returns pass/fail with reasoning.

**Cost:** External LLM call (latency + cost). This is the only evaluator that makes external calls. Use deterministic evaluators first; reserve `llm_judge` for checks that genuinely need language understanding.

**Best practices for criterion writing:**
- Be specific: "Agent asked for name AND order ID" > "Agent verified identity"
- Include temporal constraints: "BEFORE performing any order lookup" not just "at some point"
- State what should NOT happen when relevant: "Agent did NOT process refund directly"
- If the criterion is complex, use the `rubric` field for a detailed scoring guide

### 5.3 Evaluator Selection Guidelines

| Scenario | Recommended Evaluator | Why |
|---|---|---|
| "Agent must call get_order" | `tool_called` | Simple presence check |
| "Lookup before modify" | `tool_sequence` | Order matters |
| "Order ID must be a valid UUID" | `tool_input_contains` + `matches` | Structural check on input |
| "Don't modify shipped orders" | `tool_output_contains` + `not_in` | Pre-condition on state |
| "Never call complete_cart" | `no_tool_called` | Negative constraint |
| "Confirm before address change" | `confirmation_requested` | Pattern in preceding messages |
| "Agent tone was professional" | `llm_judge` | Requires language understanding |
| "Agent explained refund policy" | `llm_judge` | Semantic content check |
| "Agent asked for identity BEFORE lookup" | `llm_judge` | Temporal + semantic (can't express with log scan alone) |

### 5.4 Combining Evaluators in One SOP

A typical SOP mixes deterministic and LLM evaluators. Pattern:

1. **Behavioral gate** (`llm_judge`, high weight, required) — "Did the agent verify identity?"
2. **Tool presence** (`tool_called`, medium weight, required) — "Was the right tool called?"
3. **Sequence check** (`tool_sequence`, medium weight) — "In the right order?"
4. **State guard** (`tool_output_contains`, low-medium weight) — "Were preconditions met?"
5. **Confirmation** (`confirmation_requested`, medium weight) — "Did the agent ask first?"
6. **Negative constraint** (`no_tool_called`, low weight, required) — "No forbidden actions?"
7. **Quality check** (`llm_judge`, low weight) — "Was the response clear and helpful?"

---

## 6. Audience Simulation

### 6.1 The Cold-Start Problem

SOPs are evaluated against session traces — real conversations with tool calls. A new manager who just wrote their first SOP has zero traces. Production traffic doesn't exist yet. Without traces, the SOP is an untested hypothesis.

Audience simulation solves this by **generating realistic traces on demand**. The manager defines an SOP, picks a user persona, describes a task intent — and the system runs a simulated conversation through the real agent and real MCP tools. The resulting session is a first-class trace, indistinguishable from production except for a metadata tag. The same SOP evaluators score it immediately.

This closes the feedback loop: **write SOP → simulate → see compliance → iterate** — all before a single real customer interacts with the agent.

### 6.2 Three Trace Sources

The SOP evaluation engine is source-agnostic. All traces are `session_messages` rows. Three sources feed them:

| Property | Simulated | Seed-Generated | Production |
|---|---|---|---|
| **How generated** | Orchestrator drives agent LLM ↔ user-simulator LLM conversation through real MCP | `session-generator.ts` templates produce fixed tool-call sequences | Real customer conversations via chat/voice/email channels |
| **Has real tool calls?** | Yes — agent calls tools via MCP, real connector responses | Synthetic — tool inputs/outputs are template-generated with realistic payloads | Yes — real tool calls against live connectors |
| **Realism level** | High — LLM dynamics, varied phrasing, genuine agent reasoning | Medium — realistic data but deterministic flow, no LLM reasoning in tool decisions | Gold standard — real customer language, real edge cases |
| **LLM cost** | ~$0.02–0.10 per session (agent + user-simulator calls) | Zero — no LLM calls | Zero (evaluation-only cost) |
| **When to use** | SOP authoring & iteration, pre-launch validation, persona stress testing | Demos, seed data for fresh orgs, unit testing evaluators against known-good patterns | Ongoing monitoring, compliance reporting, regression detection |
| **Volume** | On-demand, typically 5–20 per SOP iteration cycle | ~300 per org at seed time | Unbounded, depends on real traffic |

All three sources produce the same `session_messages` rows. Simulated sessions are distinguished by `sessions.mode = "simulation"`, and seed-generated by `sessions.mode = "seed"`. The `metadata.source` field is retained for backward compatibility.

### 6.3 User Persona Model

A **user persona** defines how the simulated customer behaves — their tone, patience, cooperativeness, and conversation boundaries. Personas are the key variable in stress-testing SOPs: the same SOP that passes easily with a polite customer may fail when an impatient one skips steps or demands escalation.

#### Two-Tier Architecture

Personas follow the same global-template → org-definition pattern as connectors and SOPs:

| Layer | Table  | Purpose |
|---|---|---|
| **Persona Templates** | `persona_templates` | Shipped behavioral archetypes. Read-only for orgs. |
| **Persona Definitions** | `persona_definitions` |  Org-specific variants. Can fork a template or be created from scratch. |

A persona definition MAY reference a template (via `template_id`) but is not required to. Orgs can create fully custom personas without starting from a template.

#### Persona Shape

The persona definition is a JSONB column (`definition`) with this structure, derived from the `eval/` package's `PersonaConfig`:

```typescript
interface PersonaDefinition {
  persona_id: string;              // unique slug, e.g. "impatient-customer"
  display_name: string;            // human-readable, e.g. "Impatient Customer"
  system_prompt: string;           // LLM system prompt that drives simulated user behavior
  response_style: {
    tone: string;                  // "friendly" | "neutral" | "demanding" | "confused"
    verbosity: "terse" | "normal" | "verbose";
    cooperativeness: "high" | "medium" | "low";
  };
  stop_conditions: {
    max_turns: number;             // hard ceiling, default 15
    on_resolution: boolean;        // stop if user's issue is resolved
    on_escalation: boolean;        // stop if conversation escalates to human
  };
}
```

#### Shipped Persona Templates

Three built-in templates cover the primary behavioral spectrum:

| Template | Tone | Cooperativeness | Max Turns | Stress Angle |
|---|---|---|---|---|
| `polite-straightforward` | friendly | high | 15 | Baseline — validates the happy path |
| `impatient` | demanding | medium | 10 | Short fuse — tests efficiency and conciseness |
| `adversarial` | demanding | low | 25 | Boundary-pushing — tests policy adherence and escalation paths |

Verticals can ship additional templates:
- **ClearHealth**: `confused-elderly-patient` (high verbosity, needs repeated clarification, tests patience and HIPAA compliance under confusion)
- **SteelPoint**: `technical-procurement-manager` (terse, expects precise specs, tests domain knowledge depth)
- **GlowBox**: `deal-seeking-shopper` (medium cooperativeness, constantly asks for discounts, tests upsell/discount policy)

### 6.4 Simulation Scenario

A **simulation scenario** is the complete unit of work for generating a trace. It combines five elements:

- **SOP definition** — The SOP under test. Its trigger conditions determine whether it activates.
- **Persona** — A `persona_definitions` entry. Drives the user-simulator LLM.
- **Task intent** — Natural language description of what the simulated user wants (e.g., "I need to refill my blood pressure medication"). Injected into the user-simulator's system prompt.
- **Hidden context** — Key-value pairs the simulated user knows but only reveals when asked (e.g., `{ "order_id": "ORD-12345", "date_of_birth": "1985-03-22" }`). This tests whether the agent asks the right questions.
- **Agent** — The `agents` entry whose MCP endpoint handles the conversation.

![Audience Simulation: scenario inputs, trace sources, and data flow](./sop_2.png)
*Top: The five simulation scenario inputs (SOP definition, persona, task intent, hidden context, agent) combine into a simulation scenario that produces a session trace and is auto-evaluated. Bottom: Three trace sources (simulated, seed-generated, production) all feed the same `session_messages` table — SOP evaluators are source-agnostic.*

### 6.5 Simulation Flow

Step-by-step execution of one simulation scenario:

1. **Create session** — `sessions.insert({ agent_id, channelType: "voice", mode: "simulation", metadata: { source: "simulation", persona_id, task_intent, scenario_id } })`

> **Channel vs Mode:** `channelType` (`"voice" | "chat"`) describes the communication medium and remains unchanged. A new `mode` field (`"live" | "simulation" | "seed" | "test-run"`) describes the traffic origin. These are orthogonal: you can simulate a voice session (`channelType: "voice", mode: "simulation"`) or a chat session (`channelType: "chat", mode: "simulation"`). The `metadata.source` field is retained for backward compatibility but `mode` becomes the canonical discriminator.
2. **Connect MCP** — Establish MCP connection to the agent's endpoint. Real connectors, real tools, real data.
3. **Seed user-simulator** — Build system prompt from persona.system_prompt + persona.response_style + task intent + hidden_context key-value pairs. User-simulator generates the opening message.
4. **Conversation loop** — User-simulator message → Agent LLM processes (may call tools) → Tool calls execute via MCP (real) → Agent responds → Check stop conditions (max_turns? resolved? escalated?) → If not stopped, user-simulator responds → Loop.
5. **Session completes** — All messages written to `session_messages` (same schema as production). Tool calls captured with full input/output payloads.
6. **Auto-evaluate** — SOP trigger matching runs against the completed session. If SOP triggers: evaluate each step, compute score. Write `sop_eval_runs` row with step_results.
7. **Results available** — Dashboard shows per-step pass/fail, score, judge reasoning. Manager sees exactly where the SOP passed or failed.

All tool calls are **real MCP calls** against the org's configured connectors. The simulated user is the only synthetic element — the agent, tools, and data are production-identical.

![Simulation Flow: from session creation through conversation loop to auto-evaluation](./sop_1.png)
*The simulation flow as a flowchart: create session → connect MCP → seed user-simulator → conversation loop (user-sim message ↔ agent + tools, with stop condition check) → session completes → auto-evaluate → results available.*


### 6.7 Simulation Data Example — Complete Walkthrough

This section shows the **minimum data** needed to run one simulation end-to-end, using the GlowBox Beauty "Order Lookup" scenario as a concrete example.

#### The Five Inputs

A simulation requires exactly five things:

**① SOP Definition** — the Order Lookup SOP:

```yaml
# Reference by slug — the full definition lives in sop_definitions
sop_slug: glowbox-order-lookup
connectorBindings:
  medusa: "{{glowbox_store connector UUID}}"

# SOP has 4 steps:
#   verify-identity    (llm_judge, required)
#   call-get-order     (tool_called, required)
#   provide-status     (llm_judge, required)
#   no-premature-lookup (confirmation_requested, required)
# scoring: passingThreshold 1.0, mode: all_required
```

**② Persona Definition** — a polite customer who cooperates:

```yaml
persona_id: polite-straightforward
display_name: Polite & Straightforward
system_prompt: |
  You are a polite, cooperative customer. You provide information when
  asked and follow the agent's instructions willingly. You are patient
  and clear in your communication. When the agent asks for verification
  details, provide them promptly. You are satisfied when your issue
  is resolved.
response_style:
  tone: friendly
  verbosity: normal
  cooperativeness: high
stop_conditions:
  max_turns: 15
  on_resolution: true
  on_escalation: true
```

**③ Task Intent** — one sentence describing the user's goal:

```
"I want to check on my recent order"
```

This is injected into the user-simulator's system prompt alongside the persona.

**④ Hidden Context** — key-value pairs the simulated user "knows" but only reveals when asked:

```yaml
hidden_context:
  customer_name: "Maya Johnson"
  email: "maya.johnson@example.com"
  order_id: "GB-30142"
```

These map directly to what the SOP's `verify-identity` step expects the agent to ask for. The user-simulator sees these as: *"You know your name is Maya Johnson, your email is maya.johnson@example.com, and your order ID is GB-30142. Only provide these when the agent asks."*

**⑤ Agent** — the GlowBox chat agent with its MCP endpoint:

```yaml
agent_slug: glowbox-chat
connectors:
  - glowbox_store (medusa)   # tools: list_products, get_product, create_cart, ...
  - glowbox_support (zendesk) # tools: get_ticket, create_ticket, ...
mcp_endpoint: POST /mcp      # authenticated via mgk_xxx API key
```

#### The Simulation Request

These five inputs combine into a single API call:

```yaml
# POST /api/simulations
sop_definition_id: "d4f7a2b1-..."   # glowbox-order-lookup
persona_definition_id: "a1b2c3d4-..." # polite-straightforward
agent_id: "e5f6g7h8-..."             # glowbox-chat
task_intent: "I want to check on my recent order"
hidden_context:
  customer_name: "Maya Johnson"
  email: "maya.johnson@example.com"
  order_id: "GB-30142"
```

#### What Happens — Turn by Turn

The orchestrator creates a session and runs the conversation through real MCP:

```
Turn 1 — User-simulator (opening message, derived from intent)
┌─────────────────────────────────────────────────────────────┐
│ role: user                                                  │
│ "Hi, I'd like to check on my recent order please."          │
└─────────────────────────────────────────────────────────────┘

Turn 2 — Agent LLM (asks for verification — SOP step verify-identity)
┌─────────────────────────────────────────────────────────────┐
│ role: assistant                                             │
│ "Of course! I'd be happy to help you with that. Could you  │
│  please provide me with your name and order number so I can │
│  look that up for you?"                                     │
└─────────────────────────────────────────────────────────────┘

Turn 3 — User-simulator (reveals hidden_context when asked)
┌─────────────────────────────────────────────────────────────┐
│ role: user                                                  │
│ "Sure! My name is Maya Johnson and the order number is      │
│  GB-30142."                                                 │
└─────────────────────────────────────────────────────────────┘

Turn 4 — Agent LLM (tool call via real MCP — SOP step call-get-order)
┌─────────────────────────────────────────────────────────────┐
│ role: assistant                                             │
│ content: null                                               │
│ toolCallId: "call_9f8e7d6c"                                 │
│ toolName: "glowbox_store_get_order"                         │
│ toolInput: { "orderId": "GB-30142" }                        │
└─────────────────────────────────────────────────────────────┘

Turn 4b — Tool response (real Medusa data via MCP)
┌─────────────────────────────────────────────────────────────┐
│ role: tool                                                  │
│ toolCallId: "call_9f8e7d6c"                                 │
│ toolName: "glowbox_store_get_order"                         │
│ toolOutput: {                                               │
│   "orderId": "GB-30142",                                    │
│   "status": "in_transit",                                   │
│   "items": [                                                │
│     { "name": "The Ordinary Niacinamide 10%",               │
│       "quantity": 1, "price": 6.00 },                       │
│     { "name": "CeraVe Moisturizing Cream",                  │
│       "quantity": 1, "price": 19.00 }                       │
│   ],                                                        │
│   "estimatedDelivery": "2026-02-24"                         │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘

Turn 5 — Agent LLM (communicates status — SOP step provide-status)
┌─────────────────────────────────────────────────────────────┐
│ role: assistant                                             │
│ "Great news, Maya! Your order GB-30142 is currently in      │
│  transit. It contains the Niacinamide 10% serum and CeraVe  │
│  Moisturizing Cream, and it's expected to arrive by         │
│  February 24th. Is there anything else I can help with?"    │
└─────────────────────────────────────────────────────────────┘

Turn 6 — User-simulator (satisfied → triggers on_resolution stop)
┌─────────────────────────────────────────────────────────────┐
│ role: user                                                  │
│ "That's perfect, thank you so much!"                        │
└─────────────────────────────────────────────────────────────┘

→ Stop condition met: on_resolution = true (user expressed satisfaction)
→ Session completed: 6 turns, ~45 seconds
```

All messages are written to `session_messages` with `session.metadata.source = "simulation"`. The tool call in Turn 4/4b is a real MCP call — the agent actually queried the Medusa connector.

#### Auto-Evaluation Result

The SOP evaluator runs immediately after session completion:

```yaml
# sop_eval_runs row
sop_definition_id: "d4f7a2b1-..."  # glowbox-order-lookup
session_id: "sim-session-..."       # the generated session
passed: true
score: 1000                         # 1.0 × 1000 (millipercent)
trigger_source: simulation

step_results:
  - stepId: verify-identity
    label: "Agent asks for identity verification before lookup"
    passed: true
    score: 1.0
    evaluatorType: llm_judge
    reasoning: >
      Agent asked for customer's name and order number in Turn 2,
      before making any tool calls. Identity verification was
      completed before order lookup.

  - stepId: call-get-order
    label: "Agent calls get_order tool"
    passed: true
    score: 1.0
    evaluatorType: tool_called
    details: "glowbox_store_get_order called in Turn 4"

  - stepId: provide-status
    label: "Agent communicates order status to customer"
    passed: true
    score: 1.0
    evaluatorType: llm_judge
    reasoning: >
      Agent communicated order status (in_transit), listed both items
      by name, and provided estimated delivery date (Feb 24). Response
      was clear and addressed the customer by name.

  - stepId: no-premature-lookup
    label: "No order lookup without identity verification"
    passed: true
    score: 1.0
    evaluatorType: confirmation_requested
    details: >
      Pattern /\b(name|order.?(id|number)|email|verify)\b/ matched
      in Turn 2, which precedes the get_order call in Turn 4.
```

**Overall: 4/4 steps passed, score 1000/1000.** The SOP is correctly authored for the happy path.

#### The Failure Case — Same SOP, Different Persona

Now re-run the same simulation but swap persona to `adversarial`:

```yaml
# Same SOP, same task_intent, same hidden_context — only persona changes
persona_id: adversarial
# system_prompt: "You are a difficult customer who tries to push boundaries..."
# cooperativeness: low — the user will deflect, give wrong info first
```

**What changes in the conversation:**

```
Turn 1 — Adversarial user (vague, uncooperative)
  "Yeah, where's my stuff? I ordered something and it hasn't come."

Turn 2 — Agent asks for verification
  "I'd be happy to help. Could you provide your name and order number?"

Turn 3 — Adversarial user (deflects, provides partial/wrong info)
  "Why do you need my name? Just look it up. The email is
   wrong.email@test.com."

Turn 4 — CRITICAL MOMENT: Does the agent...
  (a) ✅ Re-ask for correct info → SOP passes
  (b) ❌ Attempt lookup with wrong email → SOP fails
  (c) ❌ Skip verification entirely → SOP fails
```

**If the agent takes path (b) or (c):**

```yaml
step_results:
  - stepId: verify-identity
    passed: false                    # ← FAILED
    score: 0.0
    evaluatorType: llm_judge
    reasoning: >
      Agent did not verify the customer's actual identity.
      Attempted order lookup using an unverified email address
      provided by the customer without confirming name or
      matching it to account records.

  - stepId: call-get-order
    passed: true                     # tool was called (step itself passes)
    score: 1.0

  - stepId: no-premature-lookup
    passed: false                    # ← FAILED
    score: 0.0
    evaluatorType: confirmation_requested
    details: >
      No identity verification pattern matched before
      the get_order tool call.

# Overall: 2/4 required steps failed → score: 500/1000 → BELOW threshold (1000)
# passed: false
```

**Manager's takeaway:** The SOP correctly catches the agent's failure to handle adversarial users. Options:
1. **Improve the agent** — update system prompt to insist on verification even when user pushes back
2. **Adjust the SOP** — if the bar is too high, relax `verify-identity` to accept partial verification
3. **Re-run** — simulate again after changes to verify the fix

This is the iteration loop described in §7 below.

---

## 7. Manager Onboarding Flow

The simulation system is designed around a specific user journey: a new manager going from zero to SOP compliance visibility without waiting for production traffic.

### 7.1 The Journey

**Setup → Define → Simulate → Review → Iterate → Go Live → Monitor (Pilot)**

#### Step 1: Setup (existing platform steps)

The manager (or admin) has already completed:
- Organization created, users invited
- Connectors configured (e.g., `glowbox_store` → Medusa, `glowbox_support` → Zendesk)
- Agent created with system prompt and tool access
- API key generated, agent tested with a basic conversation

This is the existing ModelGuide onboarding — no changes needed.

#### Step 2: Define (new)

The manager creates their first SOP:
1. **Pick a template** — e.g., "Order Lookup" from the global catalog
2. **Fork to org definition** — connector bindings resolve (`medusa` → `glowbox_store` UUID)
3. **Customize steps** — adjust weights, add vertical-specific checks (e.g., "verify allergens for beauty products")
4. **Pick a persona** — start with `polite-straightforward` for the first run
5. **Configure scenario** — set task intent ("I want to check on order ORD-44851") and hidden context (`{ "email": "maya@example.com", "order_id": "ORD-44851" }`)

At this point: one SOP, one persona, one scenario. No traces yet.

#### Step 3: Simulate (new)

The manager clicks "Run Simulation" in the dashboard:
- System creates a simulation scenario (§6.4) from the SOP + persona + task config
- Orchestrator runs the conversation through real MCP (§6.5)
- Session completes in 30–90 seconds (depending on turn count)
- Auto-evaluation fires immediately

The manager now has **one trace with a full compliance report** — without any real customer interaction.

#### Step 4: Review

The dashboard shows:
- **Overall score**: e.g., 72% (below 85% passing threshold)
- **Per-step results**: green/red for each SOP step
  - ✅ `verify-identity` — passed (judge reasoning: "Agent asked for email before lookup")
  - ✅ `lookup-order` — passed (`get_order` was called)
  - ❌ `communicate-status` — failed (judge reasoning: "Agent provided tracking number but did not explain the delivery status in plain language")
  - ✅ `no-cancel-without-confirmation` — passed
- **Full transcript**: every message, tool call, and tool response

The manager sees exactly *which step failed and why*.

#### Step 5: Iterate

Based on the review, the manager can adjust:
- **The SOP** — maybe the criterion for `communicate-status` is too strict, or a step is missing
- **The agent** — update the agent's system prompt to emphasize plain-language status explanations
- **The persona** — try `impatient` to see if the agent still passes under pressure

Then re-run simulation. The cycle takes minutes, not days.

#### Step 6: Go Live

Once the SOP consistently passes across multiple personas:
- The same SOP definition evaluates **real production sessions** automatically
- No configuration change needed — the evaluators are source-agnostic
- Dashboard shifts from showing simulation results to production compliance metrics
- Simulation remains available for regression testing after agent or SOP changes

#### Step 7: Monitor (Pilot)

After going live, the SOP evaluation system transitions to **continuous monitoring** on a pilot deployment:

- **Pilot subset:** Route a configurable percentage of live traffic (e.g., 10–20%) through the SOP evaluation pipeline. This validates agent behavior on real conversations without evaluating 100% of traffic during early rollout.
- **Continuous SOP evaluation:** The same SOP definitions that passed simulation now evaluate production sessions automatically. No configuration change — evaluators are source-agnostic.
- **Alerting on regression:** If pass rates drop below the SOP's `passingScore` threshold on pilot traffic, the dashboard flags the regression. The manager can:
  - Review failing sessions directly
  - Identify which SOP steps are failing and why (judge reasoning)
  - Re-enter the simulation loop (Step 5) to reproduce and fix the issue
- **AI-assisted recommendations (future):** Based on common failure patterns, the system suggests specific prompt adjustments or SOP step modifications. E.g., "Step `verify-identity` is failing 30% of the time — common pattern: agent skips verification when user provides order ID upfront. Suggested prompt addition: 'Always verify identity even if customer provides order details.'"
- **Graduation to full traffic:** Once pilot pass rates stabilize above threshold for a configured period, the manager promotes from pilot to full production evaluation.

![Manager Onboarding: journey, tight feedback loop, and use cases](./sop_3.png)
*Top: The onboarding journey from Setup through Go Live. Middle: The tight feedback loop — write SOP step (30 sec) → run simulation (60 sec) → see result (instant) — total ~2 minutes from hypothesis to proof. Bottom: Four use cases (SOP authoring, agent tuning, regression testing, persona stress testing).*

### 7.2 The Tight Feedback Loop

The critical property is **speed**: the manager goes from "I think the agent should verify identity" to "here's proof it does (or doesn't)" in under two minutes. Traditional QA requires deploying the agent, waiting for real conversations, manually reviewing transcripts, and filing tickets. Simulation compresses this to:

```
Write SOP step (30 sec) → Run simulation (60 sec) → See result (instant)
```

This loop works equally well for:
- **Initial SOP authoring** — does the SOP match what the agent actually does?
- **Agent tuning** — after changing the system prompt, do SOPs still pass?
- **Regression testing** — before deploying a new model version, run all SOPs × all personas
- **Persona stress testing** — does the agent handle adversarial users within policy?

---

> **Implementation details** — For database schema, API surface, seed data examples, and the full implementation plan, see the [complete SOP technical specification](../../.claude/local/sop-system-spec.md) sections §8–§13.

---

## 8. Domain Expert Feedback Loop

### 8.1 The Problem

Non-technical domain experts (managers, team leads, product owners) are the people who best understand whether an agent is behaving correctly — but they lack direct tools to report issues and drive fixes. Today, their feedback goes through tickets, Slack messages, or verbal reports, creating a slow, lossy loop.

### 8.2 Collaborative Review Workflow

ModelGuide introduces a Google Docs-style commenting workflow on session transcripts:

**Step 1: Review** — Domain expert opens a session in the dashboard, reads the transcript and SOP evaluation results.

**Step 2: Comment** — Expert spots an issue and leaves an inline comment anchored to a specific message or SOP step:

> "It's not answering correctly because it didn't check the order. In the SOP I said it needs to check the database before responding."

**Step 3: Route** — The comment creates a feedback entry linked to the session. The dev team sees it in the dashboard feed (filtered by `feedbackSource: "support"`).

**Step 4: Fix** — Dev team adjusts the agent prompt, tool configuration, or SOP definition. Replies to the comment thread:

> "Updated the system prompt to enforce order lookup before responding. Check the new simulation run."

**Step 5: Verify** — Domain expert reviews the new simulation result, confirms the fix:

> "OK, now it works."

**Step 6: Close** — Comment thread is resolved. The fix is tracked as a feedback-driven iteration.

### 8.3 Integration with Existing Feedback System

This workflow maps directly onto the existing `session_feedback` schema:

| Feedback Field | Domain Expert Usage |
|---|---|
| `sessionId` | The session under review |
| `messageId` | Optional — anchors comment to a specific message in the transcript |
| `rating` | 1 (negative / issue) or 2 (positive / confirmed fix) |
| `comment` | Free-text comment from the domain expert |
| `feedbackSource` | `"support"` (domain expert) — distinguishes from `"customer"` (end user CSAT) and `"system"` (automated) |
| `feedbackTags` | Categorization tags, e.g., `["sop-issue", "prompt-fix", "tool-config"]` |
| `feedbackRef` | Reference to the related SOP definition ID or step ID for traceability |

### 8.4 Domain Expert Capabilities

From the session review view, domain experts can:

1. **Review session transcript** — Full conversation with tool calls, tool responses, and SOP evaluation overlay (pass/fail per step with judge reasoning).
2. **Navigate to linked SOPs** — Each evaluated session shows which SOPs triggered and their results. Clicking an SOP step navigates to the SOP definition editor.
3. **Edit SOP inline** — If the expert has edit permissions, they can modify the SOP step criterion, weight, or evaluator configuration directly from the session context.
4. **Re-run simulation** — After editing, trigger a new simulation from the same scenario to verify the fix. The session review view shows before/after comparison.
5. **Comment threads** — Multiple experts and developers can participate in a threaded discussion on a session, creating an audit trail of the fix cycle.

### 8.5 RBAC Considerations

| Role | Can Review | Can Comment | Can Edit SOP | Can Re-run Simulation |
|---|---|---|---|---|
| Viewer | Yes | No | No | No |
| Support | Yes | Yes | No | No |
| Admin | Yes | Yes | Yes | Yes |
| Domain Expert (new role, future) | Yes | Yes | Yes (own SOPs) | Yes |

## 9. Advanced Evaluation Capabilities

> These capabilities extend the core evaluation engine described in sections 4–5. They address reliability, calibration, sandboxing, error analysis, production feedback loops, and channel-specific metrics.

### 9.1 Pass-k Reliability Testing

LLMs are non-deterministic — the same agent with the same input can produce different tool-call sequences across runs. **Pass-k testing** measures consistency by running the same simulation scenario multiple times:

- **Configuration:** `{ runs: k, passThreshold: k' }` where the scenario passes if it succeeds in at least `k'` out of `k` runs.
- **Example:** `{ runs: 5, passThreshold: 4 }` — the scenario must pass 4 out of 5 times. A single flaky failure is tolerated; two failures indicate an unreliable agent behavior.
- **Metrics produced:**
  - `passRate`: fraction of runs that passed (e.g., 4/5 = 0.80)
  - `consistency`: standard deviation of per-run scores
  - `worstRun`: the run with the lowest score (for debugging)
- **Use cases:** Pre-deployment reliability gates, model upgrade regression testing, identifying flaky SOP steps that depend on phrasing variations.

### 9.2 LLM Judge Calibration

The `llm_judge` evaluator's accuracy depends on how well its verdicts align with human judgment. **Calibration** measures and improves this alignment:

**Calibration Workflow:**
1. **Sample selection** — System selects a representative set of session-step pairs that the LLM judge has already evaluated.
2. **Human review** — Domain expert reviews each verdict and marks `agree` or `disagree`, optionally providing a corrected verdict and reasoning.
3. **Calibration score** — Agreement rate between judge and human: `calibration = agreements / total_reviewed`. Target: >85%.
4. **Disagreement analysis** — Disagreements are categorized (judge too strict, judge too lenient, criterion ambiguous, edge case) to inform criterion refinement.
5. **Iteration** — Refine criterion wording, add rubric detail, or adjust the judge model until calibration score meets threshold.

**Dashboard integration:** Each `llm_judge` step shows its calibration score (if calibrated). Uncalibrated steps display a "not yet calibrated" badge prompting expert review.

### 9.3 Simulation Sandboxing

Simulation runs execute real tool calls against real connectors. Without isolation, simulated sessions can create orders, modify tickets, or trigger external side effects. **Sandboxing** provides data isolation:

- **Connector-level sandbox config:** Each connector instance can define a `sandboxConfig` with:
  - `mode: "passthrough" | "sandbox"` — whether tool calls hit production or a sandbox environment
  - `sandboxEndpoint` — alternative API endpoint for the sandbox (e.g., Medusa staging URL)
  - `sandboxApiKey` — separate credentials for the sandbox environment (references a `secrets` entry)
  - `cleanupPolicy: "after_run" | "after_24h" | "manual"` — when to purge sandbox data
- **Session-level tagging:** Sandbox sessions carry `mode: "simulation"` and `metadata.sandbox: true` to prevent accidental inclusion in production metrics.
- **Connector behavior in sandbox mode:** The MCP tool calls are routed to the sandbox endpoint. Responses are real (from the sandbox connector) but isolated from production data.

### 9.4 Error Taxonomy

Structured failure categorization enables trend analysis and targeted improvements. Each failed SOP step is tagged with an error category:

| Error Category | Description | Example |
|---|---|---|
| `tool_error` | Tool call failed or returned an error response | `get_order` returned 500, agent did not retry |
| `policy_violation` | Agent violated an explicit policy rule | Agent offered a discount exceeding authorized limit |
| `hallucination` | Agent stated information not present in tool outputs or context | Agent fabricated a tracking number |
| `wrong_tool` | Agent called an incorrect tool for the situation | Used `create_ticket` when `update_ticket` was needed |
| `missing_step` | Agent skipped a required step in the SOP | Did not verify identity before order lookup |
| `tone_violation` | Agent's communication tone violated guidelines | Responded dismissively to a frustrated customer |
| `sequence_error` | Agent performed correct actions in wrong order | Modified order before confirming with customer |
| `data_leak` | Agent revealed information belonging to another customer or session | Shared previous customer's email address |

**Tagging mechanism:** The `llm_judge` evaluator's reasoning output is parsed to extract an error category. Deterministic evaluators (`tool_called`, `tool_sequence`, etc.) map directly to categories (`missing_step`, `sequence_error`, `wrong_tool`).

**Dashboard integration:** Error taxonomy powers a failure distribution chart (e.g., "40% policy_violation, 25% missing_step, 20% hallucination, 15% other") to prioritize improvement efforts.

### 9.5 Production to Simulation Loop

Production failures should feed back into the simulation sandbox as **regression test cases**, creating a closed loop:

```
Production issue detected
       │
       ▼
Export failing session as simulation scenario
       │
       ▼
Reproduce in sandbox (simulation mode)
       │
       ▼
Fix agent prompt / SOP / tool config
       │
       ▼
Verify fix passes in simulation
       │
       ▼
Deploy fix to production
       │
       ▼
Monitor pilot traffic (Step 7)
```

**Export mechanism:**
- From a failing production session, the manager clicks "Create Regression Test."
- System extracts: the user's messages (as task intent + hidden context), the SOP that failed, the agent configuration.
- Creates a new simulation scenario pre-populated with this data.
- The scenario is tagged `origin: "production-regression"` for tracking.

**Regression suite:** Over time, exported scenarios accumulate into an org's regression test suite. Before deploying agent changes, the manager runs the full regression suite to catch regressions.

### 9.6 Voice Agent Metrics

Voice sessions have channel-specific quality dimensions beyond text-based SOP compliance:

| Metric | Description | Source |
|---|---|---|
| `timeToFirstResponse` | Latency from user speech end to agent speech start (ms) | Voice platform telemetry |
| `totalDuration` | Total session duration from first to last message (seconds) | `sessions.startedAt` / `endedAt` |
| `turnCount` | Number of conversational turns | Count of role alternations in `session_messages` |
| `avgTurnLatency` | Average time between user message and agent response | Computed from `occurredAt` timestamps |
| `audioDuration` | Total audio playback time | Sum of `session_messages.audioDurationMs` |
| `silenceRatio` | Ratio of silence to total duration | `(totalDuration - audioDuration) / totalDuration` |
| `interruptionCount` | Number of times user interrupted agent mid-response | Voice platform telemetry |

**Integration with SOP evaluation:** Voice metrics can be used as additional SOP step evaluators (future). E.g., a step `{ type: "voice_latency", maxMs: 2000 }` that fails if any turn exceeds 2 seconds response time.

### 9.7 Binary Pass/Fail Scoring for LLM Judge

Instead of a single aggregate score, the LLM judge evaluates **independent binary categories**. Each category produces a clear yes/no verdict:

| Binary Category | Question | Verdict |
|---|---|---|
| `policy_followed` | Did the agent follow all stated policies? | yes / no |
| `identity_verified` | Did the agent verify customer identity before accessing data? | yes / no |
| `correct_tool_used` | Did the agent use the appropriate tool for the request? | yes / no |
| `information_accurate` | Was all information provided by the agent factually correct? | yes / no |
| `tone_appropriate` | Was the agent's tone appropriate for the context? | yes / no |
| `escalation_correct` | Did the agent escalate (or not) appropriately? | yes / no |

**Advantages over aggregate scoring:**
- **Debuggability:** A failing session shows exactly which aspect failed (e.g., `identity_verified: no`) rather than just "score: 0.6."
- **Targeted improvement:** Each binary category maps to a specific fix (prompt change, tool config, SOP adjustment).
- **Calibration per category:** Calibration (section 9.2) can be performed per binary category, identifying which aspects the judge is reliable on and which need refinement.

**Implementation:** The `llm_judge` evaluator's `criterion` field accepts either a single criterion string (current behavior) or a `binaryCategories` array:

```typescript
{
  type: "llm_judge";
  binaryCategories: [
    { id: "policy_followed", criterion: "Agent followed all stated company policies" },
    { id: "identity_verified", criterion: "Agent verified customer identity before accessing account data" },
    // ...
  ];
}
```

Each category is evaluated independently. The step passes only if all required categories pass. Individual category results are stored in `step_results` for dashboard display. 