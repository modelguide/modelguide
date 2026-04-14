---
name: build-agent
description: >
  End-to-end voice agent builder. Trigger on "/build-agent" or when the user
  says "build a voice agent", "create a new agent from scratch", or "set up a
  new ModelGuide agent". Guides through 8 stages: prereq check, interview, API
  key collection, YAML generation + provisioning, eval import, simulation
  feedback loop, autonomous tightening, and local LiveKit validation. Produces
  a validated voice agent in 2-3 hours. Resumes from the last completed stage
  if .modelguide/STATE.md exists.
---

# Build-Agent Skill

End-to-end voice agent wizard. From business idea to validated local voice agent.

## Resumption

Before the interview, check for existing progress:

```bash
test -f .modelguide/STATE.md && cat .modelguide/STATE.md
```

If `currentStage` exists, skip completed stages and resume. If STATE.md doesn't exist, start from [pre].

## State Files

**`.modelguide/STATE.md`** — stage tracker:
```
currentStage: pre | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | done
mode: auto-pilot | supervised
orgSlug: <slug>
agentSlug: <slug>
agentId: <uuid>
connectorType: catalog | custom
connectorSlug: <slug>
evalIteration: 0
lastEvalScore: (none)
```

**`.modelguide/CONTEXT.md`** — interview answers and locked decisions (D-01…D-NN).

Update `currentStage` in STATE.md at the start and end of each stage.

---

## Stage [pre]: Prerequisite Check

Check Docker, Bun, and Python 3.11+:

```bash
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: MISSING"
bun --version > /dev/null 2>&1 && echo "Bun: OK" || echo "Bun: MISSING"
python3 --version 2>&1 | grep -E "3\.(1[1-9]|[2-9][0-9])" && echo "Python: OK" || echo "Python: MISSING or < 3.11"
```

If any are missing, provide the install command and wait for the developer to fix it. Do not abort.
- Docker: https://www.docker.com/products/docker-desktop/
- Bun: `curl -fsSL https://bun.sh/install | bash`
- Python 3.11+: `brew install python@3.11` (macOS) or https://python.org/downloads

**ModelGuide repo check** — verify the repo is set up:
```bash
test -f modelguide-api/.env && echo "API env: OK" || echo "API env: MISSING — run: cp modelguide-api/.env.example modelguide-api/.env and fill in required vars"
test -d modelguide-api/node_modules && echo "API deps: OK" || echo "API deps: MISSING — run: cd modelguide-api && bun install"
```
If `modelguide-api/.env` is missing, do not proceed — direct the developer to copy the example and fill in `DATABASE_URL`, `JWT_SECRET`, and other required vars.

Write STATE.md with `currentStage: 0`.

---

## Stage [0]: Define / Interview

Gather all decisions needed for agent configuration. Write answers to CONTEXT.md as locked decisions D-01…D-NN.

In supervised mode: show CONTEXT.md after all answers and wait for "continue".

### Q1 — Mode
"Would you like **auto-pilot** (I run everything) or **supervised** (I pause after each stage)?"
Default: auto-pilot. Record as D-01.

### Q2 — Business context
"Briefly describe your business and who the agent will serve (1-3 sentences)."
Derive `orgSlug` from the business name (lowercase, hyphens, max 20 chars). Record as D-02.

### Q3 — Example conversations
"Give me 3 concrete things a customer would say and what the agent should do."

Format:
```
1. [customer says X] → [agent does Y using tool Z]
2. ...
3. ...
```

Push for specific dialogue if vague. These become SOP steps and eval test cases directly.

### Q4 — Tools / API
"What systems does the agent need to call?"

Options:
- **A) Medusa** — built-in e-commerce (products, cart, orders)
- **B) Zendesk** — built-in helpdesk (tickets, knowledge base)
- **C) Named service** (e.g. "Shopify") — Claude researches API docs with WebFetch
- **D) Custom API** — ask for base URL + auth type + 3-5 operations
- **E) None** — conversation only

For C: use WebFetch to read the service's API docs, pick 4-8 endpoints relevant to the example conversations, show the tool list for confirmation.

Record as D-07 (connectorType, connectorSlug, tool names).

### Q5 — Persona
"What's the agent's name, and how should it sound?"

Options: Friendly & conversational / Professional & concise / Domain expert / Custom.
Claude infers a default from the business (retail → friendly, B2B → professional).
Record name as D-03/D-04, style as D-05.

### Q6 — Guardrails
"What should the agent NEVER do?"

Common patterns (multi-select):
- Never quote or estimate delivery dates
- Never process refunds above $X without escalation
- Never share another customer's data
- Always escalate complaints or angry customers
- Custom rule

Require at least 2 guardrails. Claude proposes sensible defaults from the business context.
Record as D-08.

### Q7 — Stack confirmation
Present the recommended stack:
```
LLM: GPT-4.1-mini (OpenAI)     — fast, cost-effective for tool-calling
STT: Deepgram Nova-3             — best accuracy for voice
TTS: ElevenLabs Flash v2.5       — natural voice quality
Framework: LiveKit Agents        — local dev support, no cloud needed

Press Enter to confirm, or tell me what to change.
```
Record as D-06.

Write STATE.md (`currentStage: 1`), write CONTEXT.md with all decisions.

---

## Stage [1]: Setup — API Key Collection

**Purpose**: Generate `agent/.env.example`, instruct developer to fill `agent/.env`, verify keys are present without reading values.

1. Create directory:
   ```bash
   mkdir -p agent/prompts/workflows
   ```

2. Generate `agent/.env.example` from `references/python-templates.md` (.env.example section).
   Substitute all `{{variables}}` from CONTEXT.md.

3. Tell the developer:
   ```
   Generated agent/.env.example. Next:
     cp agent/.env.example agent/.env
   Then fill in:
     - OPENAI_API_KEY from https://platform.openai.com/api-keys
     - DEEPGRAM_API_KEY from https://console.deepgram.com/
     - ELEVENLABS_API_KEY from https://elevenlabs.io/app/settings/api-keys

   MODELGUIDE_API_KEY and MODELGUIDE_AGENT_ID will be filled in stage [2].
   LiveKit credentials are pre-filled (no account needed for local dev).

   Tell me when agent/.env is ready.
   ```

4. Verify file exists and is non-empty:
   ```bash
   test -s agent/.env && echo "Found" || echo "Missing or empty"
   ```

5. Check required keys are set (without reading values):
   ```bash
   grep -q "^OPENAI_API_KEY=.\+" agent/.env && echo "OPENAI_API_KEY: set" || echo "OPENAI_API_KEY: MISSING"
   grep -q "^DEEPGRAM_API_KEY=.\+" agent/.env && echo "DEEPGRAM_API_KEY: set" || echo "DEEPGRAM_API_KEY: MISSING"
   # Repeat for TTS key based on stack choice
   ```

6. Ensure `API_EXTERNAL_ADDRESS` is set in the ModelGuide API env (needed for simulations):
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

Create `.modelguide/` and write 6 files from `references/yaml-templates.md`.
Substitute all `{{variables}}` from CONTEXT.md.

- `org.yaml` — slug from D-02
- `agents.yaml` — platform: livekit, config.url: ws://localhost:7880, active: true
- `connectors.yaml` — based on D-07
- `sops.yaml` — 3 SOPs from Conv-1/2/3, status: active
- `guardrails.yaml` — from D-08, always include no-fabrication baseline
- `evals.yaml` — 5-10 test cases per SOP (happy path + missing info + guardrail trigger)

### 2b. Generate Python agent code

Create `agent/` files from `references/python-templates.md`.

Copy these unchanged from `examples/agents/livekit-agent/src/`:
```bash
for f in mcp_agent.py mg_client.py tracing.py transcript.py providers.py hangup.py; do
  cp examples/agents/livekit-agent/src/$f agent/
done
```

Generate:
- `agent/agent.py` (copy example, update BuildProAgent → {{AgentClassName}})
- `agent/my_agent.py` (new MCPAgent subclass)
- `agent/config.py` (copy example, update AGENT_NAME and CONNECTOR_PREFIX defaults)
- `agent/prompts/__init__.py`
- `agent/prompts/base.py`
- `agent/pyproject.toml`

### 2c. Provision org

```bash
make db-up

# Wait for DB ready
until docker exec modelguide-postgres pg_isready -q 2>/dev/null; do
  echo "Waiting for DB..."; sleep 2
done

make db-migrate

# Dry run first
cd modelguide-api && bun run src/cli/mg.ts setup ../.modelguide/ --dry-run
```

If dry-run passes:
```bash
# Provision (skip-evals — imported separately in stage [3])
cd modelguide-api && bun run src/cli/mg.ts setup ../.modelguide/ --skip-evals
```

The `mg setup` output includes the agent API key. Copy it:
```
Agent API Key: mgk_xxxxxxxx
```
→ Update `agent/.env`: `MODELGUIDE_API_KEY=mgk_xxxxxxxx`

### 2d. Get agent UUID

The `mg setup` command prints a summary table at the end of its run, including an `["Agent", "ID", "API Key"]` row with the agent UUID. Read it from there.

In the skill, instruct Claude to:
1. Parse the agent UUID from the `mg setup` output (it appears in the printed table as a full UUID string)
2. Update `agent/.env`: `MODELGUIDE_AGENT_ID=<agentId>`
3. Update STATE.md: `agentId: <agentId>`

No additional API calls or scripts needed.

### 2e. Compile agents

```bash
cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
```

Expected: `Compiled agent: {{agentName}} (SOP: ...)` for each SOP.

Write STATE.md (`currentStage: 3`).

---

## Stage [3]: Generate Test Assets

Import eval suites into ModelGuide:

```bash
cd modelguide-api && bun run src/cli/mg.ts import-evals --org {{orgSlug}} ../.modelguide/evals.yaml
```

This creates one eval suite per (agent, SOP) pair with test cases and evaluators.

Write STATE.md (`currentStage: 4`).

In supervised mode: show import summary and wait for "continue".

---

## Stage [4]: Run Feedback Loop

**Purpose**: Simulate all eval suites and collect scored results. Single command.

### 4a. Ensure API is running

```bash
if ! curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "Starting ModelGuide API..."
  cd modelguide-api && bun run src/index.ts &
  until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do sleep 1; done
  echo "API ready"
fi
```

### 4b. Run simulations

```bash
cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}}
```

This handles everything: auth, suite listing, simulate-and-run, polling, result printing.
Expected output:
```
Suite: Order Status Inquiry
  PASS   order-status-happy-01
  FAIL   order-status-missing-id-01
         ↳ handles-missing-info: Agent proceeded without asking for order number
  PASS   order-status-guardrail-01

Pass rate: 8/10 (80%)
```

### 4c. Decision

- Pass rate ≥ 80%: skip stage [5], proceed to [6]
- Pass rate < 80%: proceed to [5] (tighten)

Store in STATE.md: `lastEvalScore: X/Y`, `evalIteration: 0`
Write STATE.md (`currentStage: 5` or `6`).

In supervised mode: display results and wait for "continue".

---

## Stage [5]: Tighten — Autonomous Revision Loop

**Purpose**: Analyze failures, apply targeted fixes, recompile, re-run. Max 3 iterations.

### Failure categorization

| Failure type | Symptom | Fix location |
|---|---|---|
| SOP | Wrong tool called, steps out of order | `.modelguide/sops.yaml` |
| Persona | Wrong tone, scope too broad/narrow | `agent/prompts/base.py` PERSONA_HEADER |
| Guardrail | Rule violated or too vague | `.modelguide/guardrails.yaml` |
| Tool | Wrong parameters, bad docstring | `agent/my_agent.py` `@function_tool` docstring/params |

### Apply fixes

**SOP fix**:
```bash
cd modelguide-api && bun run src/cli/mg.ts import-sops --org {{orgSlug}} ../.modelguide/sops.yaml
```

**Guardrail fix**:
```bash
cd modelguide-api && bun run src/cli/mg.ts import-guardrails --org {{orgSlug}} ../.modelguide/guardrails.yaml
```

**Persona/tool fix**: edit files directly (no CLI needed — recompile picks up changes).

In supervised mode: show a diff of proposed changes and wait for approval.

### Recompile and re-run

```bash
cd modelguide-api && bun run src/cli/mg.ts compile-agents --org {{orgSlug}}
cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}} --agent {{agentSlug}}
```

### Loop control

```
evalIteration += 1
if score >= 80% or evalIteration >= 3:
  if score < 80%:
    print "After 3 iterations, pass rate is X%. Proceeding to manual validation."
  → Stage [6]
else:
  → repeat from failure categorization
```

Update STATE.md: `evalIteration: N`, `lastEvalScore: X/Y`, `currentStage: 6`.

---

## Stage [6]: Validate Manually

Start the voice agent locally and give the developer a URL to talk to it.

### 6a. Install Python deps

```bash
cd agent
python3 -m venv .venv && source .venv/bin/activate && pip install -e .
# Or with uv: uv venv && uv pip install -e .
```

### 6b. Start local LiveKit (if not running)

```bash
make livekit-up &   # native, requires: brew install livekit
# OR: make livekit-up-docker

# Wait for LiveKit to be ready
until nc -z localhost 7880 2>/dev/null; do sleep 1; done
```

### 6c. Start the agent

```bash
cd agent && source .venv/bin/activate && python agent.py dev
```

The agent connects to ws://localhost:7880 and waits for a participant.

### 6d. Open meeting URL

```bash
# In a new terminal:
make livekit-token NAME=me
```

Tell the developer:
```
Your agent is running!

Open the meeting URL printed above (or run: make livekit-token NAME=me)

Your agent passed {{lastEvalScore}} eval cases. Test these scenarios:
1. {{conv1Scenario}} — expect: {{expectedBehavior1}}
2. {{conv2Scenario}} — expect: {{expectedBehavior2}}
3. {{conv3Scenario}} — expect: {{expectedBehavior3}}

Type "done" when finished testing.
```

Write STATE.md (`currentStage: 7`).

---

## Stage [7]: Improve MG — Connector PR (Optional)

Only run if `connectorType == custom` in STATE.md.

Ask: "You built a custom {{serviceName}} connector. Want to contribute it to ModelGuide so it's available to all orgs?"

If yes:
1. Invoke `@mg-connector` skill with API details from CONTEXT.md (service name, base URL, auth, tool definitions)
2. After `mg-connector` completes, open a PR:
   ```bash
   gh pr create --title "feat(connectors): add {{serviceName}} catalog connector" \
     --body "Generated by /build-agent skill. Adds {{serviceName}} as a first-class ModelGuide connector."
   ```

If no: proceed to completion.

Write STATE.md (`currentStage: done`).

---

## Completion

```
✓ Build complete!

Agent: {{agentName}} ({{orgSlug}})
Eval results: {{lastEvalScore}} test cases passed
Agent code: agent/
Config: .modelguide/

Restart the agent:
  cd agent && source .venv/bin/activate && python agent.py dev
  make livekit-token NAME=me

Re-run evals:
  cd modelguide-api && bun run src/cli/mg.ts run-evals --org {{orgSlug}}

Open dashboard:
  make ui-dev → http://localhost:3001
```
