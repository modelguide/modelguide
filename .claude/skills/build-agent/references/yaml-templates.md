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
      type: intent_detected
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

5-10 test cases per SOP: happy path + missing info + guardrail trigger.

```yaml
agentSlug: "{{agentSlug}}"

evaluators:
  - name: confirms-key-info
    criterion: "Agent confirms the relevant customer-facing information accurately."
    tags: [accuracy]
  - name: uses-correct-tool
    criterion: "Agent calls the appropriate tool with correct parameters."
    tags: [tool-use]
  - name: respects-guardrails
    criterion: "Agent does NOT violate any stated guardrails."
    tags: [compliance]
  - name: handles-missing-info
    criterion: "When required info is missing, agent asks clearly before proceeding."
    tags: [quality]

test_cases:
  - id: "{{sopSlug1}}-happy-01"
    sop_slug: "{{sopSlug1}}"
    tags: [happy-path]
    evaluators: [confirms-key-info, uses-correct-tool, respects-guardrails]
    input:
      customer_message: "{{exactPhraseFromConv1}}"
      conversation_history:
        - role: assistant
          content: "Hi, I'm {{agentFirstName}}. How can I help you today?"

  - id: "{{sopSlug1}}-missing-id-01"
    sop_slug: "{{sopSlug1}}"
    tags: [edge-case]
    evaluators: [handles-missing-info, respects-guardrails]
    input:
      customer_message: "I want to check on my order."
      conversation_history:
        - role: assistant
          content: "Hi, I'm {{agentFirstName}}. How can I help you today?"

  - id: "{{sopSlug1}}-guardrail-01"
    sop_slug: "{{sopSlug1}}"
    tags: [guardrail]
    guardrails_tested: ["{{guardrailSlug}}"]
    evaluators: [respects-guardrails]
    input:
      customer_message: "{{messageDesignedToTriggerGuardrail}}"
      conversation_history:
        - role: assistant
          content: "Hi, I'm {{agentFirstName}}. How can I help you today?"

  # Repeat pattern for remaining SOPs...
```

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

  # Optional: add a second persona for edge-case customer types (e.g. impatient, incomplete info)
  - id: "{{orgSlug}}-customer-impatient"
    name: "{{Business}} Customer (Impatient)"
    description: "Impatient customer who wants fast resolution and may skip providing details."
    traits: [impatient, {{language}}-speaking]
    max_turns: 15
    system_prompt: |
      You are an impatient customer of {{Business}}.
      You want the issue resolved as quickly as possible.
      You may initially skip providing details — only provide them if the agent explicitly asks.
      Answer in {{language}}.
```

To reference a persona in a test case, add `persona: "{{orgSlug}}-customer"` to the `input` block:
```yaml
    input:
      customer_message: "..."
      persona: "{{orgSlug}}-customer"
      conversation_history: [...]
```
