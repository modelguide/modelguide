# Complete Working Example: Acme Corp

A full end-to-end example for onboarding "Acme Corp" — an e-commerce company with a Medusa store and Zendesk support. This matches the example files in `modelguide-api/src/cli/examples/acme/`.

## Directory Structure

```
acme/
├── org.yaml
├── users.yaml
├── secrets.yaml
├── connectors.yaml
├── agents.yaml
├── sops.yaml
├── guardrails.yaml
└── sessions.yaml
```

## org.yaml

```yaml
name: "Acme Corp"
slug: "acme"
timezone: "America/Chicago"
features:
  - voice-agents
  - chat-agents
demoEnabled: false
```

## users.yaml

```yaml
users:
  - email: admin@acme.example.com
    name: "Alice Admin"
    role: admin
  - email: support@acme.example.com
    name: "Bob Support"
    role: support
```

## secrets.yaml

Standalone secrets not tied to a specific connector.

```yaml
secrets:
  - name: OpenAI API Key
    type: platform_api_key
    scope: agent
  - name: Webhook Signing Secret
    type: webhook_secret
    scope: connector
```

## connectors.yaml

Each connector references a catalog entry and declares its own secrets.

```yaml
connectors:
  - name: "Acme Store"
    slug: "acme_store"
    catalogSlug: "medusa"
    config:
      baseUrl: "https://api.acme.example.com"
      publishableKey: "pk_acme_example"
    secrets:
      - field: "secretApiKey"
        name: "Acme Store API Key"
        type: api_key

  - name: "Acme Support"
    slug: "acme_support"
    catalogSlug: "zendesk"
    config:
      subdomain: "acme"
      email: "support@acme.example.com"
    secrets:
      - field: "apiToken"
        name: "Acme Zendesk Token"
        type: api_key
```

## agents.yaml

Agents reference connector slugs for tool assignment.

```yaml
agents:
  - name: "Acme Voice Agent"
    slug: "acme-voice-agent"
    description: "Handles phone orders and support"
    modality: voice
    platform: custom
    tools:
      - connectorSlug: "acme_store"
      - connectorSlug: "acme_support"
        toolSlugs:
          - create_ticket
          - search_tickets

  - name: "Acme Chat Assistant"
    slug: "acme-chat-assistant"
    description: "Web chat support"
    modality: text
    platform: custom
    tools:
      - connectorSlug: "acme_store"
```

## sops.yaml

Mix of inline SOPs and template forks.

```yaml
sops:
  # Inline SOP — fully defined here
  - name: "Order Lookup"
    slug: "order-lookup"
    description: "Guide the agent through looking up a customer order"
    status: active
    agents:
      - "acme-voice-agent"
      - "acme-chat-assistant"
    trigger:
      type: intent
      config:
        intent: order_status
    steps:
      - id: greet
        instruction: "Greet the customer and ask for their order number or email address"
        required: true
      - id: lookup
        instruction: "Look up the order using the provided identifier"
        required: true
        tool:
          connectorSlug: "acme_store"
          toolSlug: "get_order"
      - id: summarize
        instruction: "Summarize the order status, including estimated delivery date if available"
        required: true
      - id: follow-up
        instruction: "Ask if there's anything else you can help with"
        required: false

  # Inline SOP with cross-connector tool references
  - name: "Return Request"
    slug: "return-request"
    description: "Handle a product return request"
    status: active
    agents:
      - "acme-voice-agent"
    trigger:
      type: intent
      config:
        intent: return_request
    steps:
      - id: identify
        instruction: "Ask the customer for their order number and the item they want to return"
        required: true
      - id: verify
        instruction: "Look up the order to verify it exists and is eligible for return"
        required: true
        tool:
          connectorSlug: "acme_store"
          toolSlug: "get_order"
      - id: create-ticket
        instruction: "Create a support ticket for the return request with order details"
        required: true
        tool:
          connectorSlug: "acme_support"
          toolSlug: "create_ticket"
      - id: confirm
        instruction: "Confirm the return has been initiated and provide the ticket number"
        required: true

  # Template fork — reuse a global SOP template
  # - name: "Product Recommendation"
  #   templateSlug: "product-recommendation"
  #   status: active
  #   agents: ["acme-voice-agent", "acme-chat-assistant"]
  #   connectorMapping:
  #     medusa: "acme_store"
```

## guardrails.yaml

```yaml
guardrails:
  - name: "No Medical Claims"
    slug: "no-medical-claims"
    content: |
      Never claim any product treats, cures, or prevents a medical condition.
      If a customer asks about health benefits, redirect them to consult a healthcare professional.
    description: "FDA compliance guardrail"
    config:
      priority: critical
      category: compliance
    agents:
      - "acme-voice-agent"
      - "acme-chat-assistant"

  - name: "No Competitor Disparagement"
    slug: "no-competitor-disparagement"
    content: |
      Never make negative statements about competitor products or services.
      Focus on the strengths and features of our own products.
    description: "Brand guidelines"
    config:
      priority: high
      category: brand
    agents:
      - "acme-voice-agent"
      - "acme-chat-assistant"
```

## sessions.yaml

Demo conversations showing realistic interactions.

```yaml
sessions:
  - agentSlug: "acme-voice-agent"
    externalId: "acme-demo-voice-001"
    channel: voice
    status: completed
    userIdentifier: "sarah@example.com"
    hoursAgo: 2
    messages:
      - role: user
        content: "Hi, I want to check on my order ORD-1234."
      - role: assistant
        content: "Hello Sarah! Let me look that up for you right away."
      - role: assistant
        content: "I found your order ORD-1234. It was shipped yesterday and should arrive by Thursday."
      - role: user
        content: "Great, thank you!"
      - role: assistant
        content: "You're welcome! Is there anything else I can help with?"
    feedback:
      verdict: good
      comment: "Very helpful and quick response"
      source: customer
    links:
      - url: "https://store.acme.example.com/orders/1234"
        title: "Order ORD-1234"
        resourceType: "order"

  - agentSlug: "acme-chat-assistant"
    externalId: "acme-demo-chat-001"
    channel: web
    status: completed
    userIdentifier: "john@example.com"
    hoursAgo: 5
    messages:
      - role: user
        content: "What products do you have for dry skin?"
      - role: assistant
        content: "We have several great options for dry skin! Let me show you our top picks."
      - role: user
        content: "Do you have anything with hyaluronic acid?"
      - role: assistant
        content: "Yes! Our Hydra-Boost Serum contains hyaluronic acid and is one of our bestsellers. Would you like me to add it to your cart?"
    feedback:
      verdict: good
      comment: "Good recommendations"
      source: customer

  - agentSlug: "acme-voice-agent"
    externalId: "acme-demo-voice-002"
    channel: voice
    status: abandoned
    userIdentifier: "mike@example.com"
    hoursAgo: 8
    messages:
      - role: user
        content: "I need to return a product."
      - role: assistant
        content: "I'd be happy to help with your return. Could you provide your order number?"
      - role: user
        content: "Hold on, let me find it..."
```

## Running It

```bash
# Validate first
cd modelguide-api
bun run src/cli/mg.ts setup /path/to/acme/ --dry-run

# Run with placeholder secrets (for testing)
bun run src/cli/mg.ts setup /path/to/acme/ --skip-secrets

# Run for real (will prompt for secret values)
bun run src/cli/mg.ts setup /path/to/acme/
```

## Expected Output

```
◇  mg setup — /path/to/acme
│
◇  Loading YAML files...
│
◆  All YAML files validated
│
◇  Creating organization...
│
◆  Org: Acme Corp (acme)
│
◇  Creating users...
│
◆  Users: 2 created, 0 existing
│
◇  Creating secrets...
│
◆  Secrets: 2 created, 0 existing
│
◇  Creating connectors...
│
◆  Connectors: 2 created, 0 existing
│
◇  Creating agents...
│
◆  Agents: 2 created, 0 existing
│
◇  Importing SOPs...
│
◆  SOPs: 2 imported (2 active)
│
◇  Importing guardrails...
│
◆  Guardrails: 2 created, 0 existing
│
◇  Compiling agents...
│
◆  Compiled: 2 agents, 0 skipped
│
◇  Importing sessions...
│
◆  Sessions: 3 imported
│
◇  Summary:
│  Org: Acme Corp (acme)
│  Users:
│  +---------------+---------------------------+---------+
│  | Name          | Email                     | Role    |
│  +---------------+---------------------------+---------+
│  | Alice Admin   | admin@acme.example.com    | admin   |
│  | Bob Support   | support@acme.example.com  | support |
│  +---------------+---------------------------+---------+
│
│  API Keys (shown once):
│  +---------------------+--------------------------------------+
│  | Agent               | API Key                              |
│  +---------------------+--------------------------------------+
│  | Acme Voice Agent    | mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx |
│  | Acme Chat Assistant | mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx |
│  +---------------------+--------------------------------------+
│
◇  Setup complete
```
