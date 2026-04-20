---
name: build-agent
description: >
  End-to-end voice agent builder for ModelGuide. Use this skill whenever
  someone wants to build, create, or set up a voice agent or voice bot from
  scratch — regardless of industry (dental, HVAC, retail, restaurant, gym,
  real estate, law firm, insurance, etc.). Trigger on "/build-agent" or
  phrases like "build a voice agent", "create a voice bot", "set up an agent",
  "automate our phone line / dispatch calls / inbound calls", "I need a voice
  agent for my [business]", "help me build an agent", or "I want to set up a
  new ModelGuide agent". Also trigger when someone says they are "starting from
  zero" or "starting fresh" on a new agent build. Guides through 8 stages:
  prereq check, interview, local input collection, YAML generation +
  provisioning, eval import, simulation feedback loop, autonomous tightening,
  and local LiveKit validation. Supports end-to-end provisioning for Medusa,
  Zendesk, and conversation-only agents. For other APIs, dispatches
  `@mg-connector` in parallel while the rest of the build continues — the
  build only pauses at `mg setup` if the connector isn't ready yet. Produces a
  validated voice agent in 2-3 hours. Resumes from the last completed stage if
  `.modelguide/STATE.md` exists.
---

# Build-Agent Skill

End-to-end voice agent wizard. From business idea to validated local voice agent.

## Resumption

Before the interview, check for existing progress:

```bash
test -f .modelguide/STATE.md && cat .modelguide/STATE.md
```

If `currentStage` exists, skip completed stages and resume.

Special case: if `connectorStatus: pending` (or legacy `currentStage: connector`) in STATE.md,
check `.modelguide/CONNECTOR_HANDOFF.md` before continuing:
- `status: requested` → connector is still building; continue from the last completed stage
  (skip `mg setup` — go to Stage [2b] if Stage [1] is done, else Stage [1]) and note the pause point
- `status: blocked` → show the blocker message, stop, and ask for help resolving it
- `status: completed` → sync `catalogSlug`, `connectorSlug`, `toolSlugs` from handoff into D-07,
  update `connectorStatus: done`. Then resume from whichever stage is next:
  - If `agentId` is empty (Stage [1] hasn't run): resume at Stage [1] — collect admin email,
    connector secrets, generate `.env.example`
  - If `agentId` is populated (Stage [1] done): generate `connectors.yaml` and tool blocks,
    then run `mg setup` (Stage [2c])

If STATE.md doesn't exist, start from [pre].

---

## Extend: Add a SOP to an Existing Agent

If you already have a built agent (`currentStage: done` or any stage ≥ 3) and
want to add a new use case without rebuilding, use this path instead of the full wizard.

Trigger phrases: "add a use case", "add a SOP", "teach the agent to handle X", "new scenario for the agent".

### Steps

1. **Read context** — load `CONTEXT.md` and existing `.modelguide/sops.yaml` to understand the
   current agent, connector, and SOP slugs already registered.

2. **Interview for the new SOP** (2-3 questions):
   - "Describe the new scenario in one sentence — what does the customer say and what should the agent do?"
   - "Does this require a new tool call, or can it use the existing connector?"
   - If new tool: check `CONNECTOR_HANDOFF.md` or ask which tool slug to use.

3. **Generate the new SOP** — append to `.modelguide/sops.yaml` (do not overwrite existing SOPs):
   - Follow the same structure as existing SOPs (status: active, agents: [agentSlug], steps with tool: block if applicable)
   - Name the SOP after the customer's goal, not the agent action

4. **Generate new eval cases** — append to `.modelguide/evals.yaml`:
   - At minimum: happy path, missing-info, guardrail trigger for the new SOP

5. **Import and recompile**:
   ```bash
   cd modelguide-api && bun run src/cli/mg.ts import-sops --org {{orgSlug}} ../.modelguide/sops.yaml
   cd modelguide-api && bun run src/cli/mg.ts import-evals --org {{orgSlug}} ../.modelguide/evals.yaml
   cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
   ```

6. **Run evals for just the new SOP**:
   ```bash
   cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}} --suite {{newSopSlug}}
   ```
   Apply targeted fixes if pass rate < 80%, same categorization as Stage [5].
   Once evals pass, push to the live agent (ElevenLabs only):
   ```bash
   cd modelguide-api && bun run src/cli/mg.ts sync-agent --org {{orgSlug}} --agent {{agentSlug}}
   ```

7. **Generate simulation script** for the new SOP (happy path + guardrail trigger) and show it
   so you can test it live.

---

## State Files

**`.modelguide/STATE.md`** — stage tracker:
```
currentStage: pre | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | done
mode: auto-pilot | supervised
platform: livekit | elevenlabs
orgSlug: <slug>
agentSlug: <slug>
agentId: <uuid>
connectorType: catalog | none | custom
catalogSlug: <slug> | (none) | (pending)
connectorSlug: <org-connector-slug> | (none) | (pending)
connectorStatus: done | pending | (none)
evalIteration: 0
lastEvalScore: (none)
```

**`.modelguide/CONTEXT.md`** — interview answers and locked decisions (D-01…D-NN).

**`.modelguide/CONNECTOR_HANDOFF.md`** — only for custom APIs:
```yaml
status: requested | completed | blocked
serviceName: <display name>
serviceSlug: <slug>
requestedConnectorSlug: <org>_<service>
authModel: <requested auth model>
baseUrl: <requested base URL or (none)>
operations:
  - <requested operation>
catalogSlug: <catalog slug> | (pending)
connectorSlug: <org connector slug> | (pending)
toolSlugs:
  - <tool slug>
configFields:
  - name: <non-secret field name>
    description: <what the builder should enter>
    required: true
secretFields:
  - field: <secret field name>
    name: <secret prompt label>
    type: api_key
changedFiles:
  - <path>
verification: <commands run or (pending)>
blocker: <message or (none)>
```

Slug roles:
- `serviceSlug` — interview-time slug for the external service
- `requestedConnectorSlug` — proposed org connector instance slug
- `catalogSlug` — final connector type slug in the global catalog
- `connectorSlug` — final org connector instance slug used in `agents.yaml`,
  `sops.yaml`, and runtime MCP tool names

Update `currentStage` in STATE.md at the start and end of each stage.

---

## Stage [pre]: Prerequisite Check

Check Docker, Bun, and Python 3.11+:

```bash
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: MISSING"
bun --version > /dev/null 2>&1 && echo "Bun: OK" || echo "Bun: MISSING"
python3 --version 2>&1 | grep -E "3\.(1[1-9]|[2-9][0-9])" && echo "Python: OK" || echo "Python: MISSING or < 3.11"
```

**ModelGuide repo check** — verify the repo is set up:
```bash
test -f modelguide-api/.env && echo "API env: OK" || echo "API env: MISSING — run: cp modelguide-api/.env.example modelguide-api/.env and fill in required vars"
test -d modelguide-api/node_modules && echo "API deps: OK" || echo "API deps: MISSING — run: cd modelguide-api && bun install"
```
If `modelguide-api/.env` is missing, ask the person to copy the example and fill in `DATABASE_URL`, `JWT_SECRET`, and other required vars before continuing.

Format the results as a status block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Prerequisites
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓  Docker    <version>
  ✗  Bun       missing  →  curl -fsSL https://bun.sh/install | bash
  ✓  Python    <version>
  ✓  API env   configured
  ✓  API deps  installed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use ✓ for passing items (show the version or "configured"), ✗ for missing items with the install command inline.
Show all issues at once — never stop after the first. Do not abort.
- Docker: https://www.docker.com/products/docker-desktop/
- Bun: `curl -fsSL https://bun.sh/install | bash`
- Python 3.11+: `brew install python@3.11` (macOS) or https://python.org/downloads

If all pass, end with: `All good — starting Stage [0].`
If any fail, end with: `Fix the items marked ✗ above and run me again.`

Write STATE.md with `currentStage: 0`.

---

## Stage [0]: Define / Interview

Gather all decisions needed for agent configuration. Write answers to CONTEXT.md as locked decisions D-01…D-NN.

Open each question with a progress banner so the person always knows where they are:
```
━━━ Q1 of 7 ━━━━━━━━━━━━━━━━━━━━━━━
```
After each answer is locked, confirm it on one line: `✓  D-01  Mode: auto-pilot`

### Q1 — Mode
"Would you like **auto-pilot** (I run everything) or **supervised** (I pause after each stage)?"
Default: auto-pilot. Record as D-01.

### Q2 — Business context
"Briefly describe your business and who the agent will serve (1-3 sentences)."
Derive `orgSlug` from the business name (lowercase, hyphens, max 20 chars). Record as D-02.

### → Domain research (after Q2, before Q3)

Once you know the business type, research the domain to make the rest of the interview faster and the agent smarter:

1. Search: "[business type] customer service voice agent common scenarios"
2. Search: "[business type] compliance requirements" (for regulated industries: healthcare, finance, legal, insurance)
3. Search: "[business type] API integrations" if the business type suggests a specific system (scheduling, POS, EHR, CRM)

Use findings to:
- Propose 3 realistic starter conversations for Q3 (builder confirms or customizes)
- Pre-populate domain-specific guardrail suggestions for Q6
- Identify if a catalog connector already covers this domain (e.g., appointment booking → custom; retail → Medusa; support → Zendesk)
- Flag regulated-industry requirements early (e.g., HIPAA for healthcare, PCI for payments)

Keep the research step invisible — don't list search results at the builder. Just use the knowledge to give sharper suggestions.

### Q3 — Example conversations
"Here are 3 typical scenarios for [business type]. Confirm, customize, or replace:"
```
1. [suggested customer phrase] → [suggested agent action]
2. ...
3. ...
```
Push for specific dialogue if vague. These become SOP steps and eval test cases directly. Record as part of D-02.

### Q4 — Tools / API
"What systems does the agent need to call?"

Options:
- **A) Medusa** — built-in e-commerce (products, cart, orders)
- **B) Zendesk** — built-in helpdesk (tickets, knowledge base)
- **C) None** — conversation only
- **D) Mocked demo** — the agent needs named tools but no real backend (sales demo, POC, dry-run)
- **E) Something else** (e.g. Shopify or a custom REST API)

Supported end-to-end provisioning without connector-building work: **Medusa**, **Zendesk**, **conversation-only**, **mocked demo**.

**D — Mocked demo (ADR-013):**
- Use when the business has no real API to integrate with (yet) OR the build is explicitly a demo/sales asset. Tool responses are static fixtures authored directly in `connectors.yaml` with `isMocked: true`.
- No `mg-connector` dispatch; no background subagent. The `connectors.yaml` + `mg setup` path handles everything.
- Capture in D-07: `connectorType: mocked`, `catalogSlug: {{orgSlug}}_{{serviceSlug}}` (same as connector slug), `connectorSlug: {{orgSlug}}_{{serviceSlug}}`, plus the tool list and a fixture sketch for each.
- At Stage [3] YAML generation, emit `isMocked: true` + inline `tools: [{ name, input_schema, mock_response }]`. Edits to `mock_response` flow through on re-seed without delete-then-reimport.

**E — Something else (real custom connector):**
- Capture the service name, auth model, base URL, and concrete operations in D-07
- Derive `serviceSlug` and requested org connector slug `{{orgSlug}}_{{serviceSlug}}`
- Write `.modelguide/CONNECTOR_HANDOFF.md` with `status: requested`, the captured service details, and the requested operations
- Tell the user:
  ```
  Your API isn't one of the built-in connectors, so I'm kicking off a background build for it.
  I've saved all the details — your API URL, authentication, and the endpoints — to a handoff file.
  A background process is building the connector automatically. You don't need to do anything.
  We keep going from here — the only pause would be during provisioning if the connector isn't ready yet.
  ```
- Spawn a **background subagent** using the Agent tool:
  - `run_in_background: true`
  - Task prompt: "Invoke the `mg-connector` skill (use the Skill tool with `skill: 'mg-connector'`). The handoff spec is already written to `.modelguide/CONNECTOR_HANDOFF.md` — use it as your starting context. Build the connector and ensure the file reaches `status: completed` when done."
  - Do NOT wait for it to finish
- Write STATE.md with `currentStage: 1`, `connectorStatus: pending`
- Continue immediately to Stage [1] — do NOT stop and wait

Record D-07 with both connector identifiers:
- Medusa → `connectorType: catalog`, `catalogSlug: medusa`, `connectorSlug: {{orgSlug}}_store`
- Zendesk → `connectorType: catalog`, `catalogSlug: zendesk`, `connectorSlug: {{orgSlug}}_support`
- None → `connectorType: none`, `catalogSlug: (none)`, `connectorSlug: (none)`
- Mocked demo → `connectorType: mocked`, `catalogSlug: {{orgSlug}}_{{serviceSlug}}`, `connectorSlug: {{orgSlug}}_{{serviceSlug}}`
- Custom → `connectorType: custom`, `catalogSlug: (pending)`, `connectorSlug: {{orgSlug}}_{{serviceSlug}}`

Also record the tool slugs needed by the agent.

### Q5 — Persona
"What's the agent's name, and how should it sound?"

Options: Friendly & conversational / Professional & concise / Domain expert / Custom.
Claude infers a default from the business (retail → friendly, B2B → professional, healthcare → calm & clear).

Derive:
- `agentFirstName` — the human name (e.g. "Aria", "Max")
- `agentSlug` — always `{{orgSlug}}-voice-agent` (e.g. `glowskin-voice-agent`, `coolair-voice-agent`)
- `AgentClassName` — PascalCase of the first name + "Agent" (e.g. `AriaAgent`, `MaxAgent`)
- `agentDescription` — a 1-2 sentence persona statement written **as the agent's role identity**, used verbatim as the "Role & Objective" opening of the compiled system prompt. This is NOT an internal dev note. Write it as if addressing the LLM directly (e.g. "You are a voice assistant for GlowSkin handling skincare product questions and order support. Answer only in English."). Include the language instruction if non-English.

Record name/slug/class as D-03/D-04, style as D-05.

### Q6 — Guardrails

Guardrails come in two flavors — present both clearly:

**Focus guardrails** keep the agent on-topic and concise. Without them, agents drift into long explanations, offer unsolicited advice, or handle requests outside their scope. They matter as much as safety rules for voice — nobody wants a two-minute monologue when they asked about their order.

**Safety guardrails** prevent liability, compliance violations, and escalation failures.

"Here are guardrails I'd suggest based on your business. I've split them into focus rules and safety rules — add, remove, or customize:"

**Focus (pre-populate from domain research + business context):**
- Only answer questions related to [inferred scope from Q2/Q3] — redirect anything else politely
- Keep responses to 1-3 sentences unless the customer explicitly asks for more detail
- Do not volunteer information the customer didn't ask for
- If unsure, say so briefly and offer to connect with a human — don't speculate
- Custom focus rule

**Safety (pre-populate from domain research):**
- Never quote or estimate delivery/arrival times
- Never execute financial transactions without human confirmation
- Never share another customer's data
- Always escalate complaints or angry customers
- Never give professional advice (medical, legal, financial) — redirect to a human
- Custom safety rule

Require at least 2 from each category (minimum 4 total). Claude proposes sensible defaults from business context and domain research. Record as D-08.

### Q7 — Platform & stack confirmation

First, ask which platform to deploy on:

```
Which platform should the agent run on?

  A) ElevenLabs Conversational AI  — fully managed, no code, deploy in minutes
  B) LiveKit Agents                — self-hosted Python agent, full control

Default: A (ElevenLabs), unless the builder has a reason to self-host.
```

**If ElevenLabs (A):**
```
Platform: ElevenLabs Conversational AI
LLM:      GPT-4o-mini  — fast, cost-effective (change if needed)

Press Enter to confirm, or tell me what to change.
```
Ask for the LLM model if they want a different one. Valid options: any model from the
ElevenLabs supported list (gpt-4o, gpt-4o-mini, gpt-4.1, claude-sonnet-4-5, claude-haiku-4-5,
gemini-2.5-flash, etc.). Record model as `llmModel` in D-06.

**If LiveKit (B):**
```
LLM: GPT-4.1-mini (OpenAI)     — fast, cost-effective for tool-calling
STT: Deepgram Nova-3             — best accuracy for voice
TTS: ElevenLabs Flash v2.5       — natural voice quality
Framework: LiveKit Agents        — local dev support, no cloud needed

Press Enter to confirm, or tell me what to change.
```

Record platform and full stack as D-06.

Write STATE.md (`currentStage: 1`) and CONTEXT.md with all decisions. For custom connectors, also write `connectorStatus: pending`.

After writing the files, show a locked decisions summary instead of dumping CONTEXT.md raw:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Stage [0] — decisions locked
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mode        auto-pilot
  Business    <name>  ·  <orgSlug>
  Agent       <name>  ·  <style>
  Stack       GPT-4.1-mini / Deepgram Nova-3 / ElevenLabs
  Connector   <type and status>
  Guardrails  <N focus>  ·  <N safety>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

In supervised mode, follow the summary with:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⏸  Waiting for approval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Type "continue" to start Stage [1]
```

---

## Stage [1]: Setup — Local Inputs

**Purpose**: Bootstrap the first admin user, collect connector inputs, collect API keys, and verify required local inputs without reading secret values.

1. Create directory:
   ```bash
   mkdir -p .modelguide
   # LiveKit only:
   # mkdir -p agent/prompts/workflows
   ```
   For LiveKit: `mkdir -p .modelguide agent/prompts/workflows`
   For ElevenLabs: `mkdir -p .modelguide` only — no agent code directory needed.

2. Ask for the initial ModelGuide admin email:
   ```
   What email should be the initial admin user for this org?
   ```
   Append to CONTEXT.md as `D-09 Admin User Email`.

3. Capture connector inputs (same for both platforms):
   - If `catalogSlug == medusa`, ask for Medusa base URL and publishable key. Append as `D-10 Connector Config`. Append `D-11 Connector Secrets Checklist: secretApiKey`.
   - If `catalogSlug == zendesk`, ask for Zendesk subdomain and agent email. Append as `D-10 Connector Config`. Append `D-11 Connector Secrets Checklist: apiToken`.
   - If `connectorType == custom`, check handoff status:
     ```bash
     test -s .modelguide/CONNECTOR_HANDOFF.md && echo "handoff: Found" || echo "handoff: Missing"
     grep -q "^status: completed$" .modelguide/CONNECTOR_HANDOFF.md && echo "handoff: completed" || echo "handoff: not completed"
     ```
     - If `completed` and `secretFields` present: ask for `configFields` values (D-10), copy `secretFields` into D-11. Do not invent field names.
     - If `completed` but missing `secretFields`: flag incomplete, send back to `@mg-connector`.
     - If `requested` or `blocked`: note that connector is still in progress; continue setup without connector inputs — they'll be captured on resume.
   - If `connectorType == none`, record `D-10 Connector Config: none`.

4. Generate `.modelguide/users.yaml` from `references/yaml-templates.md`. Substitute all `{{variables}}` from CONTEXT.md.

5. **Platform-specific env setup:**

   **If ElevenLabs:**
   Tell the user:
   ```
   You need one API key to get started:
     - ELEVENLABS_API_KEY   → https://elevenlabs.io/app/settings/api-keys

   The ModelGuide API key will be generated automatically in the next step.

   Add it to modelguide-api/.env:
     ELEVENLABS_API_KEY_PLACEHOLDER=<your key>

   (It will be stored securely in the ModelGuide secrets vault — not used directly from .env)
   Let me know when you have the key ready.
   ```
   Ask the user to paste the key so you can include it in `agents.yaml` secrets in Stage [2].
   Store it as `D-12 ElevenLabs API Key` in CONTEXT.md (mark: will be stored in vault, not .env).

   **If LiveKit:**
   Generate `agent/.env.example` from `references/python-templates.md`. Substitute all `{{variables}}` from CONTEXT.md.
   Tell the user:
   ```
   I've created a template at agent/.env.example. Copy it to agent/.env:
     cp agent/.env.example agent/.env

   Then fill in three API keys:
     - OPENAI_API_KEY       → https://platform.openai.com/api-keys
     - DEEPGRAM_API_KEY     → https://console.deepgram.com/
     - ELEVENLABS_API_KEY   → https://elevenlabs.io/app/settings/api-keys

   The ModelGuide keys will be generated automatically in the next step.
   LiveKit is pre-filled — no account needed for local testing.

   Let me know when agent/.env is ready.
   ```
   Verify file exists and required keys are set (without reading values):
   ```bash
   test -s agent/.env && echo "Found" || echo "Missing or empty"
   grep -q "^OPENAI_API_KEY=.\+" agent/.env && echo "OPENAI_API_KEY: set" || echo "OPENAI_API_KEY: MISSING"
   grep -q "^DEEPGRAM_API_KEY=.\+" agent/.env && echo "DEEPGRAM_API_KEY: set" || echo "DEEPGRAM_API_KEY: MISSING"
   grep -q "^ELEVENLABS_API_KEY=.\+" agent/.env && echo "ELEVENLABS_API_KEY: set" || echo "ELEVENLABS_API_KEY: MISSING"
   ```
   Format as a status block. Don't proceed until all three are set.

6. **Eval pipeline keys** (required for both platforms — evals return 0/0 without these):

   Check whether the keys are already set:
   ```bash
   grep -q "^EVAL_LLM_API_KEY=.\+" modelguide-api/.env && echo "EVAL_LLM_API_KEY: set" || echo "EVAL_LLM_API_KEY: MISSING"
   grep -q "^SIMULATION_LLM_API_KEY=.\+" modelguide-api/.env && echo "SIMULATION_LLM_API_KEY: set" || echo "SIMULATION_LLM_API_KEY: MISSING"
   ```

   If either is missing, append placeholder lines to `modelguide-api/.env`:
   ```bash
   cat >> modelguide-api/.env << 'EOF'

   # Eval pipeline — required for run-evals to produce results (all can use same OpenAI key)
   SIMULATION_LLM_API_KEY=<your-openai-key>
   SIMULATION_LLM_MODEL=gpt-5.4-mini
   SIMULATION_LLM_BASE_URL=https://api.openai.com/v1
   SIMULATION_AGENT_MODEL=openai/gpt-4.1-mini
   EVAL_LLM_API_KEY=<your-openai-key>
   EVAL_LLM_MODEL=gpt-5.4-mini
   EVAL_LLM_BASE_URL=https://api.openai.com/v1
   EOF
   ```

   Then tell the user:
   ```
   Open modelguide-api/.env and replace both <your-openai-key> placeholders with your OpenAI API key.
   Get one at: https://platform.openai.com/api-keys
   Both SIMULATION_LLM_API_KEY and EVAL_LLM_API_KEY can use the same key.
   Let me know when you've filled them in.
   ```

   Verify (without reading values):
   ```bash
   grep -q "^EVAL_LLM_API_KEY=[^<]" modelguide-api/.env && echo "EVAL_LLM_API_KEY: set" || echo "EVAL_LLM_API_KEY: MISSING or placeholder"
   grep -q "^SIMULATION_LLM_API_KEY=[^<]" modelguide-api/.env && echo "SIMULATION_LLM_API_KEY: set" || echo "SIMULATION_LLM_API_KEY: MISSING or placeholder"
   ```
   Do not proceed to Stage [2] until both are set.

7. Verify users.yaml:
   ```bash
   test -s .modelguide/users.yaml && echo "users.yaml: Found" || echo "users.yaml: Missing"
   grep -q "role: admin" .modelguide/users.yaml && echo "admin: present" || echo "admin: missing"
   ```

8. Ensure `API_EXTERNAL_ADDRESS` is set (required for ElevenLabs webhooks; good practice for LiveKit too):
   ```bash
   if ! grep -q "^API_EXTERNAL_ADDRESS=" modelguide-api/.env; then
     echo "API_EXTERNAL_ADDRESS=http://localhost:3000" >> modelguide-api/.env
     echo "Added API_EXTERNAL_ADDRESS to modelguide-api/.env"
   fi
   ```

Write STATE.md (`currentStage: 2`).

---

## Stage [2]: Generate & Compile

**Purpose**: Generate YAML + Python agent code, provision org, compile agents.

In supervised mode: show each YAML file and wait for approval before running `mg setup`.

### 2a. Generate YAML artifacts

Write provisioning files into `.modelguide/`. Do **not** overwrite `users.yaml`. Substitute all `{{variables}}` from CONTEXT.md.

**Reference files — read before generating:**
- `references/yaml-templates.md` — opinionated templates for each file (use these as the starting point)
- `.claude/skills/mg-cli/references/schemas.md` — complete field-by-field schema spec (source of truth for valid fields and values)
- `.claude/skills/mg-cli/references/examples.md` — working end-to-end example (useful for cross-checking)

If field names or valid values are unclear, consult the mg-cli schemas before inventing fields — invalid fields cause `mg setup` to fail silently or with confusing errors.

Always generate:
- `org.yaml` — slug from D-02
- `sops.yaml` — 3 SOPs from Conv-1/2/3, status: active
- `guardrails.yaml` — from D-08, always include no-fabrication baseline
- `evals.yaml` — 5-10 test cases per SOP across three shapes: full-flow (happy path + all SOP tool mocks + persona), replay (specific conversational moment via `conversation_history`), and single-turn (guardrail refusals, escalations). See `references/yaml-templates.md` for the structure + `common_evaluators:` pattern. Do NOT hand-write `tool_called` evaluators — the importer auto-derives them from each SOP step's tool binding.
- `personas.yaml` — start with 1 baseline persona, and add a **variant per branching scenario** your SOPs contain. For example: if a SOP offers "standard vs express card", emit one persona that picks standard and a `-express` variant that picks express. If a SOP handles "recognized vs suspicious transaction", emit one persona that recognizes and another that doesn't. A single catch-all persona can't reliably drive both branches under LLM non-determinism. See `references/yaml-templates.md` for format. Reference in test cases via `persona: <id>`; missing persona ID causes silent fallback to raw message.
- `sessions.yaml` — 10–15 seeded historical sessions so CSAT / feedback / trend charts render non-empty the moment the import completes. Without this the demo org looks dead on first login. Mix completed + abandoned (~15–20% abandoned), customer + support feedback sources, and cover every SOP branch. See `references/yaml-templates.md` for the distribution rules.

**`agents.yaml`** — see `references/yaml-templates.md` for ElevenLabs and LiveKit formats.

**LiveKit seed pitfalls** (easy to get wrong, caught by the CLI schema):
- `config:` accepts ONLY `url` + `agentName`. `llmModel` is rejected for livekit
  agents (it's baked into the worker image).
- `agentName` in `config` must match the profile key in the worker's
  `config/agents.yaml` exactly — the worker reads this from dispatch
  metadata to pick the profile.
- You MUST declare `livekit_api_key` + `livekit_api_secret` secrets on
  each livekit agent, with no inline `value:`. That makes `mg setup`
  prompt interactively at import time. Without them, voice-test and
  outbound dispatch throw `LiveKit credentials not found` at runtime.

**A/B variants on one worker** — when two agents share a worker but differ in
one intentional way (e.g. a prompt nudge, a different tool-set):
- Keep the delta **mechanically isolated**. For Python prompts, put the
  common parts in a shared module and expose a `build(*, include_X: bool)`
  helper. Each variant becomes a 3-line wrapper.
- Lock the invariant with a **byte-for-byte contract test** (e.g.
  `assert v2.replace(DELTA_BLOCK, "") == v1`). Without this the A/B eval
  signal drifts silently as prompts get edited.
- In the seed, each variant is its OWN agent slug and each SOP/guardrail
  attaches to the agent(s) it actually applies to — shared SOPs to both,
  delta-specific SOPs to only the matching variant.

Connector handling (same for both platforms):
- If `connectorStatus: done` (or no custom connector): generate `connectors.yaml` now
- If `connectorStatus: pending`: skip `connectors.yaml` and omit `tool:` blocks from `sops.yaml`; use `PLACEHOLDER_TOOLS: [<awaiting connector>]` comment in `agents.yaml`; generate everything else

### 2b. Generate Python agent code (LiveKit only — skip for ElevenLabs)

ElevenLabs is fully managed — no Python agent code needed. Skip this section and go straight to 2c.

For LiveKit, create `agent/` files from `references/python-templates.md`.

Copy these unchanged from `examples/agents/livekit-agent/src/`:
```bash
for f in mcp_agent.py mg_client.py tracing.py transcript.py providers.py hangup.py; do
  cp examples/agents/livekit-agent/src/$f agent/
done
```

Generate:
- `agent/agent.py` (copy example, update BuildProAgent → {{AgentClassName}})
- `agent/my_agent.py` (new MCPAgent subclass)
- `agent/config.py` (copy example, update AGENT_NAME / CONNECTOR_PREFIX defaults)
- `agent/prompts/__init__.py`
- `agent/prompts/base.py`
- `agent/pyproject.toml`

If `connectorStatus: pending`, use placeholder tool slugs in `my_agent.py` and set `TOOL_NAMES = []` temporarily. Add a `TODO: fill in tool slugs from CONNECTOR_HANDOFF.md` comment.

### 2c. Provision org

**If `connectorStatus: pending`** — check handoff status before running `mg setup`:
```bash
grep -q "^status: completed$" .modelguide/CONNECTOR_HANDOFF.md && echo "ready" || echo "pending"
```
- If still pending: "Connector is still being built. Run `cat .modelguide/CONNECTOR_HANDOFF.md` to check progress. Type 'continue' when it shows `status: completed`."
- On resume with completed handoff: sync catalogSlug/connectorSlug/toolSlugs into D-07 and STATE.md, generate `connectors.yaml`, update tool blocks in `sops.yaml` and `my_agent.py`, then proceed with `mg setup`.

```bash
make db-up

until docker exec modelguide-postgres pg_isready -q 2>/dev/null; do
  echo "Waiting for DB..."; sleep 2
done

make db-migrate

# Dry run first
cd modelguide-api && bun run src/cli/mg.ts setup ../.modelguide/ --dry-run
```

If dry-run passes:
```bash
cd modelguide-api && bun run src/cli/mg.ts setup ../.modelguide/ --skip-evals
```

**If dry-run fails**, diagnose before re-running. Common causes:

| Error | Fix |
|---|---|
| `Organization slug already exists` | Change `orgSlug` in `org.yaml` and CONTEXT.md D-02 |
| `Agent slug already exists` | Change `agentSlug` in `agents.yaml` and CONTEXT.md D-04 |
| `Connector catalog not found: <slug>` | Wrong `catalogSlug` — check `references/yaml-templates.md` for valid slugs |
| `DATABASE_URL` / connection error | Run `make db-up` and wait for `pg_isready`; check `modelguide-api/.env` |
| `JWT_SECRET` / `ENCRYPTION_KEY` missing | Fill missing vars in `modelguide-api/.env` from `.env.example` |
| Any other error | Show the full error output and stop — do not guess at a fix |

**Note:** `mg setup` is idempotent — safe to re-run on resume.

The `mg setup` output includes the agent API key. Copy it to `agent/.env`: `MODELGUIDE_API_KEY=mgk_xxxxxxxx`

### 2d. Get agent UUID

Parse the agent UUID from the `mg setup` summary table. Update:
- `agent/.env`: `MODELGUIDE_AGENT_ID=<agentId>`
- `STATE.md`: `agentId: <agentId>`

### 2e. Compile agents

```bash
cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
```

Expected: `Compiled agent: {{agentName}} (SOP: ...)` for each SOP.

Evals run against MG's compiled prompt in the database — no sync to ElevenLabs needed yet.
The live agent will be synced after evals pass (Stage [6]).

Write STATE.md (`currentStage: 3`).

---

## Stage [3]: Generate Test Assets

Import personas first (must exist before evals reference them), then eval suites:

```bash
cd modelguide-api && bun run src/cli/mg.ts import-personas --org {{orgSlug}} ../.modelguide/personas.yaml
cd modelguide-api && bun run src/cli/mg.ts import-evals --org {{orgSlug}} ../.modelguide/evals.yaml
```

To update a persona after the first import, use `--replace`:
```bash
cd modelguide-api && bun run src/cli/mg.ts import-personas --org {{orgSlug}} --replace ../.modelguide/personas.yaml
```

**Important:** `import-evals` is **not idempotent for updates** — it skips any evaluator or test case that already exists by name. If you need to update an evaluator criterion or test case input after the first import, re-running import will not apply the change. This is a known CLI gap — updating existing evaluators via `mg import-evals` is not yet supported. Track it as a follow-up if encountered.

Write STATE.md (`currentStage: 4`).

In supervised mode: show import summary and wait for "continue".

---

## Stage [4]: Run Feedback Loop

**Purpose**: Simulate all eval suites and collect scored results.

Print this at the start of Stage [4]:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Running eval suites
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [ ] Start API
  [ ] Run simulations
  [ ] Score results  →  ≥ 80% → done / < 80% → tighten
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Check each off as it completes.

### 4a. Pre-flight: verify eval LLM keys

Three separate keys are consulted during `simulate-and-run`. If any are missing, sims
fail in ~1s with no visible error and the dashboard shows `0/0 evaluators passed`.

```bash
# Persona driver (customer simulation) — reads SIMULATION_LLM_API_KEY
grep -q "^SIMULATION_LLM_API_KEY=[^<]" modelguide-api/.env && echo "SIMULATION_LLM_API_KEY: set" || echo "SIMULATION_LLM_API_KEY: MISSING or placeholder"

# Eval judge — reads EVAL_LLM_API_KEY (falls back to SIMULATION_LLM_API_KEY)
grep -q "^EVAL_LLM_API_KEY=[^<]" modelguide-api/.env && echo "EVAL_LLM_API_KEY: set" || echo "EVAL_LLM_API_KEY: MISSING or placeholder"

# Agent-under-test LLM — Mastra resolves SIMULATION_AGENT_MODEL (default
# "anthropic/claude-haiku-4-5-20251001") by reading the provider's STANDARD env
# var directly. It does NOT fall back to SIMULATION_LLM_API_KEY.
#
# Check the provider prefix in SIMULATION_AGENT_MODEL and ensure the matching
# raw env var is set. Default is anthropic, so check ANTHROPIC_API_KEY unless
# SIMULATION_AGENT_MODEL is overridden.
model_env=$(grep "^SIMULATION_AGENT_MODEL=" modelguide-api/.env | cut -d= -f2- | tr -d '"')
provider="${model_env%%/*}"
case "$provider" in
  openai|"")    # empty = default (anthropic)
    if [ -z "$provider" ]; then provider="anthropic"; fi
    ;;
esac
expected_key=$(echo "$provider" | tr '[:lower:]' '[:upper:]')_API_KEY
grep -q "^${expected_key}=[^<]" modelguide-api/.env && echo "${expected_key}: set (provider: $provider)" || echo "${expected_key}: MISSING — required for SIMULATION_AGENT_MODEL (provider: $provider)"
```

If any shows `MISSING or placeholder`: stop. Tell the user to open `modelguide-api/.env`,
set the real key for that env var, and restart the API before re-running evals. Do NOT
run evals with placeholders.

Gotcha: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are **separate env vars** from
`SIMULATION_LLM_API_KEY` / `EVAL_LLM_API_KEY`. If `SIMULATION_AGENT_MODEL` is
`openai/gpt-4.1-mini` you need `OPENAI_API_KEY` set — reusing `SIMULATION_LLM_API_KEY`
doesn't satisfy it.

### 4b. Ensure API is running

```bash
if ! curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "Starting ModelGuide API..."
  cd modelguide-api && bun run src/index.ts &
  until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do sleep 1; done
  echo "API ready"
fi
```

### 4c. Run simulations

```bash
cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}}
```

### 4d. Decision

- Pass rate ≥ 80%: skip stage [5], proceed to [6]
- Pass rate < 80%: proceed to [5] (tighten)

Store in STATE.md: `lastEvalScore: X/Y`, `evalIteration: 0`
Write STATE.md (`currentStage: 5` or `6`).

In supervised mode: display results and wait for "continue".

---

## Stage [5]: Tighten — Autonomous Revision Loop

**Purpose**: Analyze failures, apply targeted fixes, recompile, re-run. Max 3 iterations.

### Progress header (show at the start of every iteration)

Print this before doing any work in Stage [5], and update it each iteration:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tighten loop — iteration N / 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [✓] Categorize failures
  [ ] Apply fixes
  [ ] Recompile
  [ ] Re-run evals
  [ ] Decide: pass / iterate / escalate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Previous score: X/Y  →  Target: ≥ 80%
```

Check each item off (`[✓]`) as it completes. This gives the person a live view of
where things stand without them needing to ask.

### Eval quality standards

Before running the tighten loop, verify the eval suite itself is sound. Weak evals produce misleading pass rates.

**Minimum per SOP:** happy path · missing-info (customer omits required field, agent must ask) · guardrail trigger. Add edge cases for any step marked CRITICAL in the SOP.

**Conversation history strategy for reliability:** LLM simulations are non-deterministic. Long multi-turn flows from scratch produce inconsistent results. Use `conversation_history` to pre-populate the flow up to just before the behavior you're testing — leave only 1-2 turns for the simulation.

Example: to test that an agent proactively mentions Apple Pay deactivation, fill history through identity → card blocked → standing orders → card ordered, then set `customer_message` to "Dziękuję, to wszystko." — one predictable turn left.

**Evaluator criteria scoping:** LLM judges evaluate the entire transcript including `conversation_history`. For multi-SOP agents, a criterion like "agent does not mention Apple Pay" will fire on prior turns from a different SOP that legitimately mentioned it. Always scope criteria to the current response:
- Bad:  `"The agent does not give information about X"`
- Good: `"In the agent's response to this customer message, the agent does not give information about X. Information provided in earlier turns as part of a different SOP workflow does NOT count as a violation."`

**Evaluator vs. SOP failures:** Before editing a SOP, check whether the agent actually behaved correctly and the criterion is too broad. Signs of a false positive: the agent does the right thing but the evaluator still fails; failure only appears on test cases with long conversation_history. If you suspect a false positive but the CLI does not yet support updating existing evaluator criteria (known gap — `import-evals --update`), note the affected cases and treat them as known non-issues when interpreting the pass rate.

### Failure categorization

| Failure type | Symptom | Fix location |
|---|---|---|
| SOP | Wrong tool called, steps out of order, missing clarification | `.modelguide/sops.yaml` |
| Persona | Wrong tone, scope too broad/narrow | `agents.yaml` description field + DB UPDATE + recompile (ElevenLabs) or `agent/prompts/base.py` PERSONA_HEADER (LiveKit) |
| Guardrail | Rule violated or too vague | `.modelguide/guardrails.yaml` |
| Tool | Wrong parameters, bad docstring | `agent/my_agent.py` `@function_tool` docstring/params |
| Evaluator | Criterion fires on correct behavior (false positive) | Update `evals.yaml` criterion + note as known CLI gap if re-import can't apply it |

After categorizing, print a brief summary before making any changes:

```
Found N failures:
  • SOP (K):    <affected SOP slugs>  →  <what's wrong>
  • Guardrail (K):  <affected rule>   →  <what's wrong>
  • Tool (K):   <affected tool slug>  →  <what's wrong>
```

Track which SOP slugs were touched — you'll use these for targeted re-runs.

### Apply fixes

**SOP fix** — edit `.modelguide/sops.yaml`, then import:
```bash
cd modelguide-api && bun run src/cli/mg.ts import-sops --org {{orgSlug}} ../.modelguide/sops.yaml
```

**Guardrail fix** — edit `.modelguide/guardrails.yaml`, then import:
```bash
cd modelguide-api && bun run src/cli/mg.ts import-guardrails --org {{orgSlug}} ../.modelguide/guardrails.yaml
```

**Persona/tool fix**: edit files directly (no CLI needed — recompile picks up changes).

**In supervised mode — show changes before applying them.** Format each change as a
clear before/after block so it's easy to read at a glance:

```
── sops.yaml · order-status-inquiry ──────────────────
  BEFORE   steps:
             - id: lookup
               instruction: "Look up the order."

  AFTER    steps:
             - id: identify
               instruction: "Ask for the order number or email."   ← added
               required: true
             - id: lookup
               instruction: "Look up the order using the identifier provided."

── guardrails.yaml · no-delivery-estimates ────────────
  BEFORE   content: "Never estimate delivery times."

  AFTER    content: "Never estimate or imply delivery dates or timeframes,
                     even when asked directly. Say you don't have that
                     information and offer to connect them with a human."
```

Show all changes together before running any commands. Wait for "continue" (or "skip"
to skip a specific change). Only apply what was approved.

### Recompile and targeted re-run

```bash
cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
```

Re-run only the suites that were actually changed — faster than running everything:
```bash
# For each SOP slug that was fixed:
cd modelguide-api && bun run src/cli/mg.ts run-evals \
  --org {{orgSlug}} --agent {{agentSlug}} --suite {{fixedSopSlug1}}
# If multiple SOPs changed, run each suite separately or use --suite for each
```

If guardrails or persona changed (not SOP-specific), run the full suite:
```bash
cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}}
```

### Loop control

After each re-run, print the updated progress header with the new score, then decide:

```
score ≥ 80%  →  Stage [6]  (print: "Pass rate X% — moving to manual validation")
score < 80% and iterations < 3  →  repeat from failure categorization
score < 80% and iterations = 3  →  Stage [6]  (print: "After 3 iterations, pass rate is X%.
                                               Proceeding to manual validation anyway.")
```

Update STATE.md each iteration: `evalIteration: N`, `lastEvalScore: X/Y`.
Write `currentStage: 6` when exiting.

---

## Stage [6]: Validate Manually

### 6a. Sync to ElevenLabs (ElevenLabs only — skip for LiveKit)

Evals passed — now push the validated compiled prompt to the live agent:

```bash
cd modelguide-api && bun run src/cli/mg.ts sync-agent --org {{orgSlug}} --agent {{agentSlug}}
```

Expected output:
```
✓ Create ElevenLabs agent: Agent ID: <el-agent-id>   ← first run only
✓ API key secret: Created secret
✓ MCP server: Created
✓ Post-call webhook: Created
✓ Agent configuration: Applied compiled prompt + LLM model ({{llmModel}})
✓ Conversation-init webhook: URL: http://...
✓ Save sync results
```

If any step fails, diagnose before continuing — the live agent won't work correctly until sync succeeds.

### 6b. Generate simulation scripts

Before giving the person a URL to test, generate realistic conversation scripts they can walk through. Base these on D-02 (business), D-08 (guardrails), the 3 example conversations from Q3, and domain research.

For each SOP, generate:
- **Happy path** — ideal customer, complete information, smooth resolution
- **Missing info** — customer vague or incomplete, agent must probe before acting
- **Guardrail trigger** — customer asks for something the agent must deflect (e.g., "When will it arrive exactly?")
- **Upset customer** — frustrated tone, should escalate to human

Format each script as:

```
Scenario: [title]
---
You (customer): [opening line]
> Agent should: [expected behavior]

You: [follow-up if the agent asks for clarification]
> Agent should: [expected behavior]

You: [guardrail trigger or edge case if applicable]
> Agent should: [expected behavior]
---
```

### 6b. Start and test — platform-specific

**ElevenLabs:**

No local setup needed — the agent is already live on ElevenLabs. Give the builder a direct link to test it:

```
Your agent is live on ElevenLabs!

Test it here:
  https://elevenlabs.io/app/conversational-ai/agents

Open your agent → click "Test agent" in the top right.

Your agent passed {{lastEvalScore}} eval cases. Work through these conversation scripts:

[simulation scripts here]

Type "done" when finished. If the agent behaved unexpectedly on any script, describe what happened and I'll tighten the SOPs.
```

**LiveKit:**

Install Python deps:
```bash
cd agent
python3 -m venv .venv && source .venv/bin/activate && pip install -e .
# Or with uv: uv venv && uv pip install -e .
```

Start local LiveKit (if not running):
```bash
make livekit-up &   # native, requires: brew install livekit
# OR: make livekit-up-docker

until nc -z localhost 7880 2>/dev/null; do sleep 1; done
```

Start the agent:
```bash
cd agent && source .venv/bin/activate && python agent.py dev
```

Tell the user:
```
Your agent is running!

Open the meeting URL printed above (or run: make livekit-token NAME=me)

Your agent passed {{lastEvalScore}} eval cases. Work through these conversation scripts:

[simulation scripts here]

Type "done" when finished. If the agent behaved unexpectedly on any script, describe what happened and I'll tighten the SOPs.
```

### 6c. Post-test tighten (optional)

If unexpected behavior is reported after manual testing, apply targeted fixes (same categorization as Stage [5]) and re-run the specific failing eval suite.

Recompile and re-run evals first — only sync if they pass:
```bash
cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}} --suite {{sopSlug}}
# ElevenLabs only — push once evals pass:
cd modelguide-api && bun run src/cli/mg.ts sync-agent --org {{orgSlug}} --agent {{agentSlug}}
```

Write STATE.md (`currentStage: 7`).

---

## Stage [7]: Improve MG — Connector PR (Optional)

Only run if `connectorType == custom`.
Skip if `@mg-connector` already prepared or opened the connector PR.

Ask: "You built a custom {{serviceName}} connector. Want to contribute it to ModelGuide so it's available to all orgs?"

If yes:
1. Reuse `.modelguide/CONNECTOR_HANDOFF.md` and existing connector files
2. Invoke `@mg-connector` only if needed to prepare the contribution PR
3. After `mg-connector` completes, open a PR:
   ```bash
   gh pr create --title "feat(connectors): add {{serviceName}} catalog connector" \
     --body "Generated by /build-agent skill. Adds {{serviceName}} as a first-class ModelGuide connector."
   ```

Write STATE.md (`currentStage: done`).

---

## Completion

**ElevenLabs:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓  Build complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent      {{agentName}}  ·  {{orgSlug}}
  Platform   ElevenLabs Conversational AI
  Score      {{lastEvalScore}} evals passed
  Config     .modelguide/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Re-deploy after changes:
  cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
  cd modelguide-api && bun run src/cli/mg.ts sync-agent --org {{orgSlug}} --agent {{agentSlug}}

Re-run evals:
  cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}}

Test in ElevenLabs:
  https://elevenlabs.io/app/conversational-ai/agents

Dashboard:
  make ui-dev  →  http://localhost:3001
```

**LiveKit:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓  Build complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent      {{agentName}}  ·  {{orgSlug}}
  Platform   LiveKit Agents
  Score      {{lastEvalScore}} evals passed
  Code       agent/
  Config     .modelguide/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Restart:
  cd agent && source .venv/bin/activate && python agent.py dev
  make livekit-token NAME=me

Re-run evals:
  cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}}

Dashboard:
  make ui-dev  →  http://localhost:3001
```
