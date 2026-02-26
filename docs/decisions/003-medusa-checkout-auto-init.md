# ADR-003: Auto-Select Shipping & Payment on Cart Completion (Medusa)

## Status

Accepted (updated 2026-02-26 — added shipping auto-selection)

## Context

Medusa v2 requires both a **shipping method** and a **payment session** on a cart before it can be completed. Without these steps, `POST /store/carts/{id}/complete` fails — either because Medusa hasn't created the payment collection (which requires a shipping method) or because no payment session has been initialized.

In a traditional storefront, the customer explicitly picks a shipping method and payment method during checkout. But in an **agent-driven** flow — where a voice or chat AI is placing the order on behalf of the customer — this interactive selection doesn't make sense:

1. **Agents don't have checkout UIs.** There is no checkout page where the user selects shipping speed or taps "Pay with Stripe". The agent is orchestrating the order programmatically.
2. **Most stores have simple fulfillment setups.** A single region typically has one or two shipping options (e.g., standard and express). Asking the agent to "pick" adds unnecessary complexity.
3. **Most Medusa stores have one payment provider per region.** The common setup is a single payment provider (e.g., Stripe) configured per region. Asking the agent to "pick" from a list of one is unnecessary ceremony.
4. **Draft orders are the goal.** In agent-assisted commerce, the priority is getting the order into the system as quickly as possible. The merchant can then handle payment capture, invoicing, or manual payment through their admin dashboard. This is analogous to a phone order taken by a human agent — the order is created first, payment is settled after.
5. **`completeCart` should be self-contained.** Exposing shipping selection and payment session initialization as separate tools would require the AI agent to understand Medusa's internal checkout state machine (cart → shipping method → payment collection → payment session → complete). This leaks platform internals into the agent's tool surface and increases the chance of errors in multi-step orchestration.

## Decision

The `completeCart` handler auto-selects shipping and initiates a payment session before completing the cart:

1. Fetch the cart to check its current state
2. If no shipping method is set, query `GET /store/shipping-options?cart_id=` and select the **cheapest available option**
3. If no payment collection exists, create one via `POST /store/payment-collections` (Medusa v2 requires explicit creation — it is not auto-created by adding shipping)
4. Query `GET /store/payment-providers?region_id=` to discover available providers
5. Select the **first available provider** and create a payment session
6. Complete the cart

The selection strategies are deliberately simple:
- **Shipping:** pick the cheapest option. This ensures the customer isn't surprised by a premium shipping charge they didn't request. If the cart already has a shipping method (e.g., set by an earlier tool call), it is left unchanged.
- **Payment provider:** pick the first one. Single-provider regions (the common case) get the only option. Multi-provider regions get a deterministic default — the merchant controls provider ordering in Medusa's configuration.

### What this does NOT do

- It does not process actual payment (no card charge, no PayPal redirect). It initializes the session so Medusa allows the cart to transition to an order.
- It does not hardcode provider or shipping option IDs. Both are resolved dynamically from the cart's region.

## Future Extensions

If a merchant needs agent-driven flows to support explicit selection:

1. **Add a `selectShippingMethod` tool** that lists available options and lets the agent (or customer via the agent) choose one
2. **Add a `selectPaymentMethod` tool** for multi-provider regions
3. **Make auto-selection configurable** via connector config (e.g., `autoSelectShipping: true | false`, `autoInitPayment: true | false`)
4. **Support payment links** — instead of initializing a session, return a hosted payment page URL that the agent can share with the customer for self-service payment

For now, auto-selection with cheapest-shipping and first-provider is the right default for agent-driven commerce.

## Consequences

### Positive

- `completeCart` works end-to-end without requiring the agent to understand Medusa's checkout state machine
- No hardcoded IDs — shipping options and payment providers are resolved dynamically
- Idempotent — if shipping is already set, the auto-selection step is skipped
- Descriptive errors when prerequisites are missing (no shipping options, no payment collection, no region, no providers)

### Negative

- In multi-provider regions, the agent cannot choose a specific provider (acceptable for now — see Future Extensions)
- The agent cannot choose express shipping — auto-select always picks cheapest (acceptable — see Future Extensions)
- Extra API calls on every cart completion — acceptable latency for checkout flows

### Risks

- If Medusa changes the shipping or payment session APIs, this handler will need updating
- If a provider requires additional configuration during session creation (beyond `provider_id`), this simple approach won't work — would need provider-specific logic
