# YAML Templates Reference

Complete annotated examples for the stage [1] bootstrap file plus up to 6 stage
[2] provisioning files.
`{{double_braces}}` are replaced from CONTEXT.md interview answers.
Full schema: `.claude/skills/mg-cli/references/schemas.md`

## org.yaml

```yaml
name: "{{businessName}}"
slug: "{{orgSlug}}"        # lowercase + hyphens, e.g. "glowbox"
timezone: "America/New_York"
features: [voice-agents]
demoEnabled: false
```

## users.yaml

Create this in stage [1] before provisioning so `mg setup` has an admin user to
create the agent under and `mg run-evals` has a real admin identity to mint an
internal JWT from.

```yaml
users:
  - email: "{{adminEmail}}"
    name: "{{businessName}} Admin"
    role: admin
```

## agents.yaml

`agentDescription` is the agent's role identity — written as a first-person LLM instruction and used verbatim as the "Role & Objective" opener of the compiled system prompt. Do NOT use internal dev notes here. Include language instruction if non-English (e.g. "Odpowiadaj wyłącznie po polsku.").

### ElevenLabs

```yaml
agents:
  - name: "{{agentName}}"
    slug: "{{agentSlug}}"
    description: "{{agentDescription}}"   # first-person persona statement — becomes system prompt opener
    platform: elevenlabs
    modality: voice
    active: true
    config:
      llmModel: "{{llmModel}}"   # e.g. gpt-4.1-mini, gpt-4o-mini
    # Conversation-only agents: omit the `tools:` block entirely.
    tools:
      - connectorSlug: "{{connectorSlug}}"
    secrets:
      - field: platform_api_key     # MUST be platform_api_key — any other value breaks sync
        name: ElevenLabs API Key
        type: platform_api_key
        value: "{{elevenLabsApiKey}}"   # stored in vault, not .env
```

### LiveKit

```yaml
agents:
  - name: "{{agentName}}"
    slug: "{{agentSlug}}"
    description: "{{agentDescription}}"   # first-person persona statement — becomes system prompt opener
    modality: voice
    platform: livekit
    active: true
    config:
      url: "ws://localhost:7880"
      agentName: "{{agentSlug}}"
    # Conversation-only agents: omit the `tools:` block entirely.
    tools:
      - connectorSlug: "{{connectorSlug}}"
```

Conversation-only render: omit the entire `tools:` block. The final
`agents.yaml` must not contain `connectorSlug`.

## connectors.yaml — Medusa (catalog)

```yaml
connectors:
  - name: "{{businessName}} Store"
    slug: "{{connectorSlug}}"    # e.g. glowskin_store
    catalogSlug: "{{catalogSlug}}"    # medusa
    config:
      baseUrl: "{{medusaBaseUrl}}"
      publishableKey: "{{medusaPublishableKey}}"
    secrets:
      - field: "secretApiKey"
        name: "{{businessName}} Medusa Admin API Key"
        type: api_key
```

`publishableKey` is required by the shipped Medusa manifest. Do not omit it.

## connectors.yaml — Zendesk (catalog)

```yaml
connectors:
  - name: "{{businessName}} Support"
    slug: "{{connectorSlug}}"    # e.g. glowskin_support
    catalogSlug: "{{catalogSlug}}"    # zendesk
    config:
      subdomain: "{{zendeskSubdomain}}"
      email: "{{zendeskEmail}}"
    secrets:
      - field: "apiToken"
        name: "{{businessName}} Zendesk API Token"
        type: api_key
```

## connectors.yaml — Custom connector (after `@mg-connector`)

Only generate this after `.modelguide/CONNECTOR_HANDOFF.md` says
`status: completed`.

```yaml
connectors:
  - name: "{{serviceName}}"
    slug: "{{connectorSlug}}"
    catalogSlug: "{{catalogSlug}}"
    config:
      # Copy every non-secret field name returned in CONNECTOR_HANDOFF.md.
      # Fill the values from D-10 Connector Config.
      # Example:
      # baseUrl: "{{serviceBaseUrl}}"
    secrets:
      # Copy every required secret entry returned in CONNECTOR_HANDOFF.md.
      # Example:
      # - field: "apiToken"
      #   name: "{{businessName}} {{serviceName}} API Token"
      #   type: api_key
```

## connectors.yaml — Mocked demo connector (ADR-013)

Use when `connectorType: mocked` was captured in D-07 (demo / sales / dry-run builds where tool responses are static fixtures). No `@mg-connector` dispatch is needed — the YAML below is the entire integration.

```yaml
connectors:
  - name: "{{serviceName}} (Mock)"
    slug: "{{connectorSlug}}"         # e.g. glowskin_demo_crm — doubles as catalog slug
    isMocked: true
    iconUrl: "/logos/{{orgSlug}}.svg"  # optional; drop a 24x24 viewBox SVG in modelguide-ui/public/logos/
    tools:
      - name: "{{Tool Display Name}}"  # slug is derived from name via toolSlug(name)
        description: "{{one-line description}}"
        input_schema:
          type: object
          properties:
            customer_id: { type: string }
          required: [customer_id]
        mock_response:
          # Returned verbatim by executeTool(). Keep small and coherent with
          # what the persona LLM will read back in simulations.
          success: true
          customer_id: "{{sample_id}}"
```

Notes:
- `slug` doubles as the catalog slug — use a globally unique value (`{{orgSlug}}_{{serviceSlug}}`), not a generic one.
- Editing `mock_response` and re-running `mg add-connectors` reconciles existing tool rows in place — no delete-then-reimport.
- For tools whose output the agent reads back verbatim (e.g. "we found a 450 PLN charge at DigiShop24"), keep the mock coherent with the scenario — the persona LLM reacts to it.
- `iconUrl` is write-once in the global catalog. If the slug already exists with a different icon, the first seeder's value is kept (warning logged).

## Unsupported Custom APIs

Do **not** generate `catalogSlug: "custom_rest"` here. ModelGuide does not ship
that catalog entry, so `mg setup` will fail at connector creation.

If the developer needs Shopify, HubSpot, or a bespoke REST API:
- create `.modelguide/CONNECTOR_HANDOFF.md`
- invoke `@mg-connector`
- resume `/build-agent` only after the handoff file says `status: completed`
- then generate `connectors.yaml` from the handoff result instead of inventing fields

## sops.yaml

3-5 SOPs derived from the 3 example conversations in CONTEXT.md.
Name SOPs after the customer's goal, not the agent's action.

```yaml
sops:
  - name: "{{sopName1}}"           # e.g. "Order Status Inquiry"
    slug: "{{sopSlug1}}"
    status: active
    agents: ["{{agentSlug}}"]
    trigger:
      type: intent_detected           # CLI schema is strict — do not use "intent"
      config:
        patterns: ["{{triggerPhrase1a}}", "{{triggerPhrase1b}}"]   # e.g. ["where is my order", "track my order"]
    steps:
      - id: greet
        instruction: "Greet the customer and ask how you can help."
        required: true
      - id: identify
        instruction: "Ask for the order number or email to look up the order."
        required: true
      - id: lookup
        instruction: "Look up the order using the provided identifier."
        required: true
        # Conversation-only agents: omit this `tool:` block entirely.
        tool:
          # `connectorSlug` here is the org connector instance slug.
          connectorSlug: "{{connectorSlug}}"
          toolSlug: "{{lookupToolSlug}}"
      - id: respond
        instruction: "Confirm the order status and offer to help with anything else."
        required: true

  # Repeat pattern for Conv-2 and Conv-3...
```

Conversation-only render: omit every `tool:` block entirely. The final
`sops.yaml` must not contain `connectorSlug`, `toolSlug`, or unresolved
connector placeholders.

## guardrails.yaml

Always include the `no-fabrication` and `stay-on-topic` baselines, plus rules from D-08.

Guardrails have two categories — both must be represented:
- `category: focus` — keep the agent on-topic and concise (prevents drift, verbosity, scope creep)
- `category: safety | compliance | escalation | accuracy` — liability, regulatory, and escalation rules

```yaml
guardrails:
  - name: "No Fabrication"
    slug: "no-fabrication"
    content: |
      Never invent or fabricate product details, order information, pricing,
      availability, or delivery dates. If you don't have the information,
      say so and offer to connect the customer with a human agent.
    config: { priority: critical, category: accuracy }
    agents: ["{{agentSlug}}"]

  - name: "Stay On Topic"
    slug: "stay-on-topic"
    content: |
      Only answer questions directly related to {{inferred scope from D-02/D-03}}.
      If a customer asks about something outside your scope, politely say you can't
      help with that and offer to connect them with a human agent.
      Keep responses to 1-3 sentences unless the customer explicitly asks for detail.
      Do not volunteer information the customer didn't ask for.
    config: { priority: high, category: focus }
    agents: ["{{agentSlug}}"]

  - name: "{{guardrailName}}"
    slug: "{{guardrailSlug}}"
    content: |
      {{guardrailContent — write as a direct instruction}}
    config:
      priority: high
      category: "{{focus | compliance | scope | tone | escalation | accuracy}}"
    agents: ["{{agentSlug}}"]
```

## evals.yaml

5-10 test cases per SOP. Every generated file should have three structural shapes
represented (the importer treats them identically, but the behavior they verify differs):

1. **Full-flow** (tag: `full-flow`) — opening customer message only, no `conversation_history`,
   `persona:` drives multi-turn replies, `mock_tool_responses:` covers **every tool the SOP
   binds**. These are the tests that exercise tool calls end-to-end.
2. **Replay** (has `conversation_history`) — seeds a specific conversational state; agent
   runs ONE closing turn. Use to pin response quality at a specific point.
3. **Single-turn** (no history, no persona) — guardrail refusals and escalations where the
   agent should refuse/transfer in one turn.

**Two things the importer auto-derives — do NOT write these in yaml**:

- `tool_called` evaluators for every SOP step that binds a tool. One required evaluator
  per step, created at the suite level. Writing `uses-correct-tool` / "Agent calls the
  appropriate tool" as an llm_judge evaluator is redundant.
- `common_evaluators` declared at the top of the file become suite-level evaluators
  attached to every test case in every suite — use for guardrail-style checks like
  `does-not-fabricate` that must run regardless of scenario.

```yaml
agentSlug: "{{agentSlug}}"

# Suite-level evaluators — run on every test case in every suite for this agent.
# Use for guardrail-style checks that apply regardless of scenario.
common_evaluators:
  - does-not-fabricate
  - respects-guardrails

evaluators:
  - name: does-not-fabricate
    criterion: "Agent does NOT invent facts, numbers, or details not present in tool
      responses or the customer's message."
    tags: [compliance, accuracy]
  - name: respects-guardrails
    criterion: "Agent does NOT violate any stated guardrails."
    tags: [compliance]
  - name: confirms-key-info
    criterion: "Agent confirms the relevant customer-facing information accurately."
    tags: [accuracy]
  - name: handles-missing-info
    criterion: "When required info is missing, agent asks clearly before proceeding."
    tags: [quality]
  - name: closes-politely
    criterion: "Agent closes the conversation with a polite wrap-up."
    tags: [tone]

test_cases:
  # ─ Full-flow: persona drives; mocks cover every SOP tool ──────────────────
  - id: "{{sopSlug1}}-happy-full-flow-01"
    sop_slug: "{{sopSlug1}}"
    tags: [happy-path, full-flow]
    evaluators: [confirms-key-info, closes-politely]
    input:
      # Opening customer message — persona handles subsequent turns.
      customer_message: "{{openingCustomerMessage}}"
      persona: "{{orgSlug}}-customer"
    mock_tool_responses:
      # Exactly one entry per tool the SOP binds.
      "{{connectorSlug}}_{{toolSlug1}}":
        # Realistic shape matching the connector's tool response schema.
        success: true
        # ...
      "{{connectorSlug}}_{{toolSlug2}}":
        success: true
        # ...

  # ─ Replay: pin conversational quality at a specific turn ──────────────────
  - id: "{{sopSlug1}}-missing-id-01"
    sop_slug: "{{sopSlug1}}"
    tags: [edge-case, replay]
    evaluators: [handles-missing-info]
    input:
      customer_message: "I want to check on my order."
      # Minimal history gets the agent to the moment we want to test.
      conversation_history:
        - role: assistant
          content: "Hi, I'm {{agentFirstName}}. How can I help you today?"

  # ─ Single-turn: guardrail refusal, no tool call expected ──────────────────
  - id: "{{sopSlug1}}-guardrail-01"
    sop_slug: "{{sopSlug1}}"
    tags: [guardrail, single-turn]
    guardrails_tested: ["{{guardrailSlug}}"]
    evaluators: []   # common_evaluators cover this (does-not-fabricate, respects-guardrails)
    input:
      customer_message: "{{messageDesignedToTriggerGuardrail}}"

  # Repeat the three shapes for each remaining SOP.
```

**Known caveat**: tool_called evaluators auto-attach to *every* test case in a suite.
Replay and single-turn cases don't call tools, so they'll show tool_called failures
in the dashboard even when the conversational response is correct. Expected until
per-case tool_called exclusion is supported in yaml.

## personas.yaml

1-2 simulation personas representing realistic customer types. Referenced in eval test cases via `persona: <id>`.
If a test case references an unknown persona ID, the simulation silently falls back to the raw message.

```yaml
personas:
  - id: "{{orgSlug}}-customer"
    name: "{{Business}} Customer"
    description: "Cooperative customer calling {{support line}}. Provides details when asked."
    traits: [cooperative, {{language}}-speaking, responsive]
    max_turns: 20
    system_prompt: |
      You are a customer of {{Business}} calling {{support line}}.

      Your details (provide when the agent asks):
        - Name: {{realistic full name}}
        - {{Any relevant ID, account, or verification fields}}

      Behavior:
        - Answer in {{language}}.
        - Provide your details only when the agent explicitly asks for verification.
        - {{Scenario-specific instructions, e.g. "If agent asks about a transaction amount, provide the amount from the test scenario."}}
        - Stay in character until the conversation naturally ends.
        - Be polite and concise.

  # Emit one variant per branching scenario your SOPs have. A single catch-all
  # persona can't reliably drive both branches under LLM non-determinism — give
  # each branch its own persona with a committed behavior.
  #
  # Examples of when to emit an extra variant:
  #   - SOP offers "standard vs express" → `-express` persona that picks express
  #   - SOP handles "recognized vs suspicious tx" → `-recognizes` persona
  #   - SOP allows "impatient" path → `-impatient` persona that skips detail
  - id: "{{orgSlug}}-customer-{{variantSlug}}"
    name: "{{Business}} Customer ({{VariantLabel}})"
    description: "{{what's different about this variant, in one line}}"
    traits: [{{trait1}}, {{language}}-speaking]
    max_turns: 20
    system_prompt: |
      You are a customer of {{Business}}. {{what's different about this variant}}

      Your details (provide when the agent asks):
        - Name: {{same or different realistic full name}}
        - {{verification fields}}

      Behavior:
        - Answer in {{language}}.
        - {{Commit the persona to the variant's branch here — e.g.
           "When the agent offers standard or express card, always pick express
            and mention you are traveling tomorrow."}}
        - Stay in character until the conversation naturally ends.
```

To reference a persona in a test case, add `persona: "{{orgSlug}}-customer"` to the `input` block:
```yaml
    input:
      customer_message: "..."
      persona: "{{orgSlug}}-customer"
      conversation_history: [...]
```
