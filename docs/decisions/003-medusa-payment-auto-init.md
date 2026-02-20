# ADR-003: Auto-Initiate Payment Session on Cart Completion (Medusa)

## Status

Accepted

## Context

Medusa v2 requires a payment session to be initialized on a cart's payment collection before the cart can be completed. Without this step, `POST /store/carts/{id}/complete` returns a _"Payment collection has not been initiated for cart"_ error.

In a traditional storefront, the customer explicitly picks a payment method (credit card, PayPal, etc.) during checkout. But in an **agent-driven** flow — where a voice or chat AI is placing the order on behalf of the customer — this interactive selection doesn't make sense:

1. **Agents don't have payment UIs.** There is no checkout page where the user taps "Pay with Stripe". The agent is orchestrating the order programmatically.
2. **Most Medusa stores have one provider per region.** The common setup is a single payment provider (e.g., Stripe) configured per region. Asking the agent to "pick" from a list of one is unnecessary ceremony.
3. **Draft orders are the goal.** In agent-assisted commerce, the priority is getting the order into the system as quickly as possible. The merchant can then handle payment capture, invoicing, or manual payment through their admin dashboard. This is analogous to a phone order taken by a human agent — the order is created first, payment is settled after.
4. **`completeCart` should be self-contained.** Exposing payment session initialization as a separate tool would require the AI agent to understand Medusa's internal checkout state machine (cart → payment collection → payment session → complete). This leaks platform internals into the agent's tool surface and increases the chance of errors in multi-step orchestration.

## Decision

The `completeCart` handler auto-initiates a payment session before completing the cart:

1. Fetch the cart to get its `payment_collection.id` and `region_id`
2. Query `GET /store/payment-providers?region_id=` to discover available providers
3. Select the **first available provider** and create a payment session
4. Complete the cart

The provider selection strategy is deliberately simple: pick the first one. This works because:
- Single-provider regions (the common case) get the only option
- Multi-provider regions get a deterministic default — the merchant controls provider ordering in Medusa's configuration

### What this does NOT do

- It does not process actual payment (no card charge, no PayPal redirect). It initializes the session so Medusa allows the cart to transition to an order.
- It does not hardcode a provider ID. The provider is resolved dynamically from the cart's region.

## Future Extensions

If a merchant needs agent-driven flows to support explicit payment method selection (e.g., "pay with PayPal" vs "pay with Stripe"), the path forward would be:

1. **Add a `selectPaymentMethod` tool** that lists available providers for a cart and lets the agent (or customer via the agent) choose one
2. **Make auto-init configurable** via connector config (e.g., `autoInitPayment: true | false`), so merchants who need explicit selection can disable the automatic behavior
3. **Support payment links** — instead of initializing a session, return a hosted payment page URL that the agent can share with the customer for self-service payment

For now, auto-init with first-provider selection is the right default for agent-driven commerce.

## Consequences

### Positive

- `completeCart` works end-to-end without requiring the agent to understand Medusa's payment internals
- No hardcoded provider IDs — works across different Medusa configurations
- Descriptive errors when prerequisites are missing (no payment collection, no region, no providers)

### Negative

- In multi-provider regions, the agent cannot choose a specific provider (acceptable for now — see Future Extensions)
- Extra API calls on every cart completion (fetch cart + list providers + create session) — acceptable latency for checkout flows

### Risks

- If Medusa changes the payment session initialization API, this handler will need updating
- If a provider requires additional configuration during session creation (beyond `provider_id`), this simple approach won't work — would need provider-specific logic
