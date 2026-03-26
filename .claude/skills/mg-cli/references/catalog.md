# Connector Catalog & SOP Templates

Available catalog entries and SOP templates that can be referenced in YAML files. Source of truth: `modelguide-api/src/db/seed/`.

## Connector Catalog

These are the `catalogSlug` values you can use in `connectors.yaml`. The catalog is seeded globally (not per-org) — if a `catalogSlug` is not found, the database seed may need to be re-run.

### `medusa` — E-commerce (Medusa v2)

**Config fields:**
- `baseUrl` — Medusa API base URL (e.g., `https://api.store.example.com`)
- `publishableKey` — Medusa publishable API key (optional)

**Secret fields:**
- `apiKey` — Medusa admin API key

**Available tools:**
| Tool Slug | Description |
|-----------|-------------|
| `list_products` | Search products by query, with limit/offset |
| `get_product` | Get product details by ID |
| `create_cart` | Create a shopping cart (regionId, currencyCode, email) |
| `get_cart` | Get cart details by ID |
| `add_to_cart` | Add items to cart |
| `set_delivery_address` | Set shipping address on cart |
| `complete_cart` | Complete checkout |
| `get_order` | Get order details by ID |
| `look_up_order_history` | Look up orders for a customer |

---

### `zendesk` — Helpdesk / Support

**Config fields:**
- `subdomain` — Zendesk subdomain (e.g., `acme` for `acme.zendesk.com`)
- `email` — Zendesk admin email

**Secret fields:**
- `apiToken` — Zendesk API token

**Available tools:**
| Tool Slug | Description |
|-----------|-------------|
| `list_tickets` | List tickets with pagination/sorting |
| `get_ticket` | Get ticket by ID |
| `create_ticket` | Create a support ticket |
| `search_tickets` | Search tickets by query |
| `get_user` | Get user by ID or email |
| `add_comment` | Add comment to a ticket |
| `list_ticket_comments` | List comments on a ticket |
| `update_ticket` | Update ticket status, priority, etc. |

---

## SOP Templates

These are the `templateSlug` values you can use in `sops.yaml` with the template fork mode.

Each template declares which connector catalog entries it references. When forking, use `connectorMapping` to map those catalog slugs to your org's connector slugs.

### Medusa Templates

| Template Slug | Description | Catalog Refs |
|---------------|-------------|-------------|
| `order-lookup` | Verify identity, retrieve order, communicate status | `medusa` |
| `return-item` | Verify purchase, check 30-day eligibility, initiate return | `medusa` |
| `damaged-item` | Document damage, offer replacement or refund | `medusa` |
| `product-recommendation` | Needs assessment, search, present options, add to cart | `medusa` |
| `safety-escalation` | Handle allergic reactions/adverse effects, escalate, refund | `medusa` |
| `reorder-replenishment` | Look up order history, check availability, add to cart | `medusa` |

**Example fork:**
```yaml
- name: "Order Lookup"
  templateSlug: "order-lookup"
  status: active
  agents: ["my-voice-agent"]
  connectorMapping:
    medusa: "my_store"      # your org's Medusa connector slug
```

### Zendesk Templates

| Template Slug | Description | Catalog Refs |
|---------------|-------------|-------------|
| `billing-dispute` | Verify identity, investigate charge, create billing ticket | `zendesk` |
| `appointment-scheduling` | Verify identity, present slots, create confirmation | `zendesk` |

**Example fork:**
```yaml
- name: "Billing Dispute"
  templateSlug: "billing-dispute"
  status: active
  agents: ["my-support-agent"]
  connectorMapping:
    zendesk: "my_helpdesk"  # your org's Zendesk connector slug
```

### Cross-Catalog Templates

| Template Slug | Description | Catalog Refs |
|---------------|-------------|-------------|
| `quote-request` | Gather requirements, lookup products, calculate pricing, create ticket | `medusa`, `zendesk` |

**Example fork:**
```yaml
- name: "Quote Request"
  templateSlug: "quote-request"
  status: active
  agents: ["my-voice-agent"]
  connectorMapping:
    medusa: "my_store"
    zendesk: "my_helpdesk"
```

## Adding New Catalog Entries

The connector catalog and SOP templates are seeded globally. To add a new connector type or SOP template, see:
- `modelguide-api/src/db/seed/connectors-catalog.ts`
- `modelguide-api/src/db/seed/sop-templates.ts`
- Use the `/mg-connector` skill for adding new connector types
