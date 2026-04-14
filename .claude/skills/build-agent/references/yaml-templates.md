# YAML Templates Reference

Complete annotated examples for all 6 config files. Use during stage [2].
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

## agents.yaml

```yaml
agents:
  - name: "{{agentName}}"
    slug: "{{agentSlug}}"    # e.g. "glowbox-voice-agent"
    description: "{{agentDescription}}"
    modality: voice
    platform: livekit
    active: true
    config:
      url: "ws://localhost:7880"
      agentName: "{{agentSlug}}"
    tools:
      # Catalog connector (Medusa or Zendesk):
      - connectorSlug: "{{connectorSlug}}"
      # Custom connector — list only tools defined in my_agent.py:
      # - connectorSlug: "{{customSlug}}"
      #   toolSlugs: [tool_one, tool_two]
```

## connectors.yaml — Medusa (catalog)

```yaml
connectors:
  - name: "{{businessName}} Store"
    slug: "{{orgSlug}}_store"    # underscores not hyphens
    catalogSlug: "medusa"
    config:
      baseUrl: "{{medusaStoreUrl}}"
    secrets:
      - field: "secretApiKey"
        name: "{{businessName}} Store API Key"
        type: api_key
```

## connectors.yaml — Custom REST

Tool slugs must match `@function_tool` method names in `my_agent.py`.
The Python agent code IS the connector for v1; stage [7] migrates to the catalog.

```yaml
connectors:
  - name: "{{serviceName}}"
    slug: "{{orgSlug}}_{{serviceSlug}}"
    catalogSlug: "custom_rest"
    config:
      baseUrl: "{{serviceBaseUrl}}"
    secrets:
      - field: "apiKey"
        name: "{{serviceName}} API Key"
        type: api_key
```

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
      type: intent
      config: { intent: "{{intentKey1}}" }   # e.g. "order_status"
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
        tool:
          connectorSlug: "{{connectorSlug}}"
          toolSlug: "{{lookupToolSlug}}"
      - id: respond
        instruction: "Confirm the order status and offer to help with anything else."
        required: true

  # Repeat pattern for Conv-2 and Conv-3...
```

## guardrails.yaml

Always include the `no-fabrication` baseline plus one rule per interview answer.

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

  - name: "{{guardrailName}}"
    slug: "{{guardrailSlug}}"
    content: |
      {{guardrailContent — write as a direct instruction}}
    config:
      priority: high
      category: "{{compliance | scope | tone | escalation}}"
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
