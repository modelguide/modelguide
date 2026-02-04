# Model Guide v0.1 - PRD: Use Cases & DB Schema

---

## Personas

### 1. Admin
- Configures the system: connectors, agents, knowledge base
- Links tools to agents
- Manages users and API keys
- Views analytics and usage metrics
- Full access to all features

### 2. Support
- Reviews sessions and transcripts
- Filters and searches sessions
- Evaluates agent performance (internal feedback)
- Views analytics (read-only)
- Cannot configure agents or connectors

### 3. Customer
- End user interacting with voice/text agent
- Places orders, asks questions, requests changes
- Can escalate to human support
- Provides CSAT feedback after session

---

## Tool Naming Convention

Tools follow a prefix-based naming convention:

### Core Tools (built-in)
Platform-level tools provided by Model Guide:
- `core_create_session` - Create authenticated backend session
- `core_end_session` - End the current session
- `core_escalate_session` - Mark session for escalation
- `core_rate_session` - Record CSAT rating

### Connector-Specific Tools
Prefixed by **unique connector slug** (not type):

**Example: `pizzapalace` connector (ecommerce):**
- `pizzapalace_add_to_cart`
- `pizzapalace_get_cart`
- `pizzapalace_create_draft_order`
- `pizzapalace_set_delivery_address`
- `pizzapalace_confirm_order`
- `pizzapalace_get_order`
- `pizzapalace_update_order_address`
- `pizzapalace_cancel_order`

**Example: `zendesk` connector (helpdesk):**
- `zendesk_create_ticket`
- `zendesk_get_ticket`
- `zendesk_update_ticket`

**Example: `sendgrid` connector (email):**
- `sendgrid_send_confirmation`
- `sendgrid_send_receipt`

**Example: `calendly` connector (calendar):**
- `calendly_check_availability`
- `calendly_book_appointment`
- `calendly_cancel_appointment`

---

## Use Cases & Flows

### UC-01: Admin Configures a Connector

**Actor:** Admin

**Preconditions:** Admin is logged in

**Flow:**
1. Admin navigates to Connectors section
2. Admin selects a connector from catalog (e.g., "Shopify", "Zendesk")
3. System displays required configuration fields (from `connectors.config_schema`)
4. Admin enters connection details (API endpoint, etc.)
5. Admin creates or selects a secret for credentials
6. Admin saves the connector tool
7. System validates connection (optional health check)
8. Connector tool is now available for agents

**Entities Involved:**
- `connectors` (catalog)
- `connector_tools` (instance)
- `secrets`

---

### UC-02: Admin Creates an Agent

**Actor:** Admin

**Preconditions:** Admin is logged in

**Flow:**
1. Admin navigates to Agents section
2. Admin clicks "Create Agent"
3. Admin enters:
   - Name (required)
   - Description (optional)
   - Type: voice (only option for now)
4. Admin clicks "Create"
5. System creates agent (inactive by default)
6. System generates API key for the agent
7. System displays API key (copyable, shown once)
8. Admin copies API key
9. Admin configures their voice infrastructure (e.g., Vapi, Retell, custom) with the API key to connect to Model Guide
10. Admin activates agent when ready

**Entities Involved:**
- `agents`
- `api_keys`

**Notes:**
- API key is scoped to this specific agent
- API key is used by external voice platforms to authenticate with Model Guide API
- Advanced configuration (persona, voice, LLM settings) done in separate edit flows

---

### UC-03: Admin Links Tools to Agent

**Actor:** Admin

**Preconditions:** Agent exists, Connector tools exist

**Flow:**
1. Admin opens agent configuration
2. Admin navigates to "Tools" tab
3. System displays available connector tools for the organization
4. Admin selects tools to enable for this agent
5. Admin marks which tools require confirmation before execution
6. Admin saves tool assignments

**Entities Involved:**
- `agents`
- `connector_tools`
- `agent_connector_tools`

---

### UC-04: New Customer Places Order via Voice Agent

**Actor:** Customer (new/anonymous)

**Preconditions:** Voice agent is active with ecommerce connector tools

**Flow:**

1. **Session Start**
   - New customer initiates voice call (no account required)
   - System creates session (channel: voice, status: active)
   - Agent greets customer: "Hi, welcome to Pizza Palace! How can I help you today?"

2. **Add Items to Cart**
   - Customer: "I'd like to order a large pepperoni pizza"
   - Agent calls `pizzapalace_add_to_cart` tool
     - Input: `{ "item": "pizza", "size": "large", "toppings": ["pepperoni"], "quantity": 1 }`
     - Output: `{ "cart_id": "cart_123", "item_id": "item_456", "subtotal": 18.99 }`
   - Agent: "I've added a large pepperoni pizza to your cart. That's $18.99. Would you like anything else?"
   
3. **Add More Items**
   - Customer: "Yes, add a 2-liter Coke and garlic bread"
   - Agent calls `pizzapalace_add_to_cart` tool (Coke)
     - Input: `{ "cart_id": "cart_123", "item": "2-liter Coke", "quantity": 1 }`
     - Output: `{ "item_id": "item_457", "subtotal": 3.49 }`
   - Agent calls `pizzapalace_add_to_cart` tool (garlic bread)
     - Input: `{ "cart_id": "cart_123", "item": "garlic bread", "quantity": 1 }`
     - Output: `{ "item_id": "item_458", "subtotal": 5.99 }`
   - Agent: "I've added a 2-liter Coke and garlic bread. Your cart total is now $28.47. Anything else?"

4. **Review Cart**
   - Customer: "No, that's it"
   - Agent calls `pizzapalace_get_cart` tool
     - Input: `{ "cart_id": "cart_123" }`
     - Output: `{ "items": [...], "subtotal": 28.47, "tax": 2.28, "total": 30.75 }`
   - Agent: "Let me confirm your order: one large pepperoni pizza, a 2-liter Coke, and garlic bread. Your total is $30.75 including tax. Should I place this order?"

5. **Create Draft Order**
   - Customer: "Yes"
   - Agent calls `pizzapalace_create_draft_order` tool
     - Input: `{ "cart_id": "cart_123" }`
     - Output: `{ "draft_order_id": "draft_789", "status": "draft" }`

6. **Collect Delivery Info**
   - Agent: "Great! Is this for delivery or pickup?"
   - Customer: "Delivery"
   - Agent: "What's the delivery address?"
   - Customer: "123 Main Street, Apartment 4B"
   - Agent calls `pizzapalace_set_delivery_address` tool
     - Input: `{ "draft_order_id": "draft_789", "address": "123 Main Street, Apt 4B" }`
     - Output: `{ "delivery_fee": 3.99, "estimated_time": "30-40 minutes" }`
   - Agent: "Delivery to 123 Main Street, Apartment 4B. There's a $3.99 delivery fee, and estimated arrival is 30-40 minutes. Your new total is $34.74."

7. **Confirm Order**
   - Agent: "Would you like to confirm this order?"
   - Customer: "Yes, confirm it"
   - Agent calls `pizzapalace_confirm_order` tool
     - Input: `{ "draft_order_id": "draft_789" }`
     - Output: `{ "order_id": "ORD-2024-1234", "status": "confirmed", "estimated_delivery": "7:45 PM" }`
   - Agent: "Your order is confirmed! Your order number is ORD-2024-1234. It should arrive by 7:45 PM. Is there anything else I can help with?"

8. **Session End**
   - Customer: "No, thanks"
   - Agent calls `core_end_session` tool
   - Agent: "Thank you for ordering from Pizza Palace! Enjoy your meal. Goodbye!"
   - Session ends (status: completed)
   - CSAT prompt triggered

**Entities Involved:**
- `sessions`
- `session_messages` (12+ messages in this flow)
- `connector_tools` (pizzapalace_add_to_cart, pizzapalace_get_cart, pizzapalace_create_draft_order, pizzapalace_set_delivery_address, pizzapalace_confirm_order, core_end_session)
- `agent_connector_tools`

**Tool Calls Summary:**
| Tool | Confirmation Required | Notes |
|------|----------------------|-------|
| pizzapalace_add_to_cart | No | Low risk, easily reversible |
| pizzapalace_get_cart | No | Read-only |
| pizzapalace_create_draft_order | No | Still a draft, not charged |
| pizzapalace_set_delivery_address | No | Can be changed |
| pizzapalace_confirm_order | Yes (implicit) | Agent verbally confirms before calling |
| core_end_session | No | Closes the session |

---

### UC-05: New Customer Order with Error Recovery

**Actor:** Customer (new/anonymous)

**Preconditions:** Voice agent is active with ecommerce connector tools

**Flow:**

1. **Session Start**
   - New customer initiates voice call (no account required)
   - Agent: "Hi, welcome to Pizza Palace! How can I help you today?"

2. **Unclear Request**
   - Customer: "I want the usual"
   - Agent: "I'm sorry, I don't have your previous orders on file. Could you tell me what you'd like to order?"

3. **Partial/Unclear Item**
   - Customer: "A pizza"
   - Agent: "Sure! What size would you like - small, medium, or large?"
   - Customer: "Hmm, big one"
   - Agent: "Got it, a large pizza. And what toppings would you like?"
   - Customer: (unclear audio / mumbles)
   - Agent: "I'm sorry, I didn't catch that. Could you repeat the toppings you'd like?"
   - Customer: "Pepperoni and mushrooms"

4. **Tool Error - Item Not Found**
   - Customer: "And add some cheesy sticks"
   - Agent calls `pizzapalace_add_to_cart` tool
     - Input: `{ "item": "cheesy sticks", "quantity": 1 }`
     - Output: `{ "error": "item_not_found", "message": "Item 'cheesy sticks' not found", "suggestions": ["cheese sticks", "mozzarella sticks"] }`
   - Agent: "I couldn't find 'cheesy sticks' on our menu. Did you mean cheese sticks or mozzarella sticks?"
   - Customer: "Cheese sticks"
   - Agent calls `pizzapalace_add_to_cart` tool (retry with corrected item)
     - Input: `{ "item": "cheese sticks", "quantity": 1 }`
     - Output: `{ "item_id": "item_460", "subtotal": 6.99 }`
   - Agent: "I've added cheese sticks to your order."

5. **Tool Error - Service Unavailable**
   - Agent calls `pizzapalace_create_draft_order` tool
     - Input: `{ "cart_id": "cart_124" }`
     - Output: `{ "error": "service_unavailable", "message": "Order service temporarily unavailable" }`
   - Agent: "I'm having trouble processing your order right now. Let me try again."
   - Agent calls `pizzapalace_create_draft_order` tool (retry)
     - Output: `{ "draft_order_id": "draft_790", "status": "draft" }`
   - Agent: "Got it! Your order is ready. Would you like delivery or pickup?"

6. **Invalid Input - Address**
   - Agent: "What's the delivery address?"
   - Customer: "Just my place"
   - Agent: "I'll need a street address for delivery. What's the street address?"
   - Customer: "Oh, 789 Pine Road"
   - Agent calls `pizzapalace_set_delivery_address` tool
     - Input: `{ "draft_order_id": "draft_790", "address": "789 Pine Road" }`
     - Output: `{ "error": "invalid_address", "message": "Address not found. Please include city or zip code." }`
   - Agent: "I couldn't verify that address. Could you give me the full address with city or zip code?"
   - Customer: "789 Pine Road, Springfield 01234"
   - Agent calls `pizzapalace_set_delivery_address` tool (retry with full address)
     - Output: `{ "delivery_fee": 3.99, "estimated_time": "35-45 minutes" }`
   - Agent: "Perfect! Delivery to 789 Pine Road, Springfield."

7. **Session Completes**
   - Order confirmed via `pizzapalace_confirm_order`, session ends via `core_end_session` (status: completed)

**Error Handling Patterns:**

| Error Type | Agent Behavior |
|------------|----------------|
| `item_not_found` | Offer suggestions if available, ask user to clarify |
| `invalid_input` | Explain what's needed, ask user to provide again |
| `service_unavailable` | Retry once automatically, then apologize and offer callback |
| `unauthorized` | Re-authenticate or escalate |
| `timeout` | Retry once, then inform user of delay |
| Unclear audio | Ask user to repeat |

**Entities Involved:**
- `sessions`
- `session_messages`
- `connector_tools`

---

### UC-06: Existing Customer Changes Delivery Address

**Actor:** Customer (existing, pre-authenticated)

**Preconditions:** Customer has existing confirmed order, customer is already authenticated via external system

**Flow:**

1. **Session Start**
   - Authenticated customer initiates voice call
   - Agent calls `core_create_session` tool
     - Endpoint: `POST https://api.modelguide.com/sessions`
     - Input: `{ "customer_id": "cust_abc123", "agent_session_id": "sess_xyz" }`
     - Output: `{ "backend_session_id": "bs_789", "token": "eyJ...", "expires_in": 3600 }`
   - Agent: "Hi John, welcome to Pizza Palace! How can I help you?"
   - Customer: "I need to change my delivery address"

2. **Identify Order**
   - Agent: "What's the order number you'd like to update?"
   - Customer: "ORD-2024-1234"
   - Agent calls `pizzapalace_get_order` tool (with session token)
     - Endpoint: `GET https://api.modelguide.com/orders/ORD-2024-1234`
     - Headers: `{ "Authorization": "Bearer eyJ..." }`
     - Input: `{ "order_id": "ORD-2024-1234" }`
     - Output: `{ "order_id": "ORD-2024-1234", "customer_id": "cust_abc123", "status": "preparing", "address": "123 Main Street, Apt 4B", "items": [...] }`
   - Agent verifies `customer_id` matches authenticated customer
   - Agent: "I found your order. It's currently being prepared for delivery to 123 Main Street, Apartment 4B. What's the new address?"

3. **Collect New Address**
   - Customer: "Change it to 456 Oak Avenue, Apt 2"
   - Agent stores new address in context (does NOT call tool yet)

4. **Confirmation Before Tool Call** ⚠️
   - Agent: "Just to confirm: you want to change the delivery address from 123 Main Street, Apartment 4B to 456 Oak Avenue, Apartment 2. Is that correct?"
   - Customer: "Yes, that's right"

5. **Execute Tool with Confirmation**
   - Agent calls `pizzapalace_update_order_address` tool (requires_confirmation: true)
     - Endpoint: `PATCH https://api.modelguide.com/orders/ORD-2024-1234`
     - Headers: `{ "Authorization": "Bearer eyJ..." }`
     - Input: `{ "order_id": "ORD-2024-1234", "new_address": "456 Oak Avenue, Apt 2" }`
     - Output: `{ "success": true, "new_estimated_time": "35-45 minutes" }`
   - Agent: "Done! Your order will now be delivered to 456 Oak Avenue, Apartment 2. The new estimated arrival time is 35-45 minutes. Is there anything else?"

6. **Session End**
   - Customer: "No, that's all"
   - Agent calls `core_end_session` tool
   - Agent: "Great! Your pizza will be on its way soon. Goodbye!"
   - Session ends (status: completed)

**Session Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Customer already authenticated (external system)             │
│                          ↓                                      │
│ 2. Agent calls core_create_session                              │
│    POST /sessions { customer_id, agent_session_id }             │
│                          ↓                                      │
│ 3. Agent receives session token                                 │
│                          ↓                                      │
│ 4. All subsequent API calls include token                       │
│    Authorization: Bearer <token>                                │
└─────────────────────────────────────────────────────────────────┘
```

**Tool Confirmation Pattern:**

When `agent_connector_tools.requires_confirmation = true`:

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent collects all required parameters                          │
│                          ↓                                      │
│ Agent summarizes the action to customer                         │
│ "I'm going to change your address to X. Is that right?"         │
│                          ↓                                      │
│ Customer confirms: "Yes"                                        │
│                          ↓                                      │
│ Agent executes tool                                             │
│                          ↓                                      │
│ Agent reports result                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Entities Involved:**
- `sessions`
- `session_messages`
- `connector_tools` (core_create_session, core_end_session, pizzapalace_get_order, pizzapalace_update_order_address)
- `agent_connector_tools` (with requires_confirmation flag)

**Tools Summary:**

| Tool | Endpoint | Confirmation | Auth Required |
|------|----------|--------------|---------------|
| core_create_session | POST /sessions | No | No |
| pizzapalace_get_order | GET /orders/{id} | No | Yes (token) |
| pizzapalace_update_order_address | PATCH /orders/{id} | Yes | Yes (token) |
| core_end_session | POST /sessions/{id}/end | No | Yes (token) |

---

### UC-07: Customer Escalates to Human Support

**Actor:** Customer

**Preconditions:** Session is active

**Flow:**
1. Customer is in active session with agent
2. Customer says "I want to speak to a human" or agent detects it cannot help
3. Agent acknowledges escalation request
4. Agent calls `core_escalate_session` tool
5. Agent calls `zendesk_create_ticket` tool
6. Tool creates ticket with session context (transcript, order info)
   - Output: `{ "ticket_id": "ZD-5678", "ticket_url": "..." }`
7. Agent informs customer: "I've created a support ticket #ZD-5678. Someone will contact you within 2 hours."
8. Session ends (status: escalated, escalation_ref: "ZD-5678")

**Entities Involved:**
- `sessions` (status → escalated, escalation_ref → ticket ID)
- `session_messages`
- `connector_tools` (core_escalate_session, zendesk_create_ticket)

---

### UC-08: Support Reviews Sessions Dashboard

**Actor:** Support

**Preconditions:** Support is logged in

**Flow:**
1. Support navigates to Sessions dashboard
2. System displays paginated list of sessions with:
   - Date/time
   - Agent name
   - Channel (voice/web/api)
   - Channel type icon
   - Status (active/completed/escalated/abandoned)
   - Duration (calculated)
   - User identifier
   - Feedback rating (if any)
3. Support can sort by date, duration, status
4. Support can search by user identifier or external ID

**Entities Involved:**
- `sessions`
- `agents`
- `session_feedback`

---

### UC-09: Support Filters Sessions

**Actor:** Support

**Preconditions:** Support is on Sessions dashboard

**Flow:**
1. Support applies filters:
   - **Channel type:** voice, web, api, slack, widget, sms, whatsapp
   - **Status:** active, completed, escalated, abandoned
   - **Agent:** specific agent or all
   - **Date range:** from/to
   - **Has feedback:** yes/no
   - **Feedback rating:** positive/negative
   - **Feedback source:** customer/support/all
2. System updates session list based on filters
3. Support can save filter presets (future feature)

**Entities Involved:**
- `sessions`
- `session_feedback`

---

### UC-10: Support Views Session Detail

**Actor:** Support

**Preconditions:** Support has selected a session

**Flow:**
1. Support clicks on a session row
2. System displays session detail view:
   - **Header:** Session ID, external_id, agent, channel_type, status, duration, timestamps
   - **Escalation:** If escalated, show escalation_ref with link to external ticket
   - **User Info:** user_identifier, user_metadata
   - **Transcript:** All session_messages in sequence
     - User messages (with audio player if voice)
     - Assistant messages (with audio player if voice)
     - Tool calls (expandable: show input/output, highlight if confirmation was required)
   - **Feedback:** Customer CSAT + Support evaluations (if any)
   - **Metadata:** Any custom metadata
3. Support can play back audio for voice sessions
4. Support can expand/collapse tool execution details
5. Tool calls that required confirmation are visually marked

**Entities Involved:**
- `sessions`
- `session_messages`
- `session_feedback`

---

### UC-11: Support Evaluates Agent Performance

**Actor:** Support

**Preconditions:** Support is viewing session detail

**Flow:**
1. Support reviews transcript and tool usage
2. Support clicks "Evaluate Session"
3. Support selects rating: thumbs up (2) or thumbs down (1)
4. Support optionally adds comment explaining evaluation
5. Support optionally selects tags: "wrong_tool", "poor_tone", "hallucination", "missed_intent", "good_resolution"
6. Support saves evaluation
7. Evaluation stored as session_feedback with:
   - feedback_source: support
   - feedback_ref: support user ID

**Entities Involved:**
- `session_feedback`
- `users` (support user)

---

### UC-12: Customer Provides CSAT Feedback

**Actor:** Customer

**Preconditions:** Session has ended

**Flow:**
1. After session ends, system prompts for feedback
   - Voice: "How would you rate this interaction? Press 1 for poor, 2 for good"
   - Text: Displays thumbs up/down buttons or 1-5 stars
2. Customer provides rating
3. System optionally asks: "Any comments?" (voice: speech-to-text)
4. Feedback stored with:
   - feedback_source: customer
   - feedback_ref: null or external customer ID

**Entities Involved:**
- `session_feedback`

---

### UC-13: Admin/Support Views Analytics

**Actor:** Admin or Support

**Preconditions:** User is logged in

**Flow:**
1. User navigates to Analytics dashboard
2. System displays key metrics:
   - **Volume:** Total sessions, by channel_type, by agent
   - **Resolution Rate:** completed / (completed + escalated + abandoned)
   - **Escalation Rate:** escalated / total
   - **Abandonment Rate:** abandoned / total
   - **Avg Session Duration** (calculated from timestamps)
   - **CSAT Score:** Avg customer rating (feedback_source: customer)
   - **Agent Evaluation Score:** Avg support rating (feedback_source: support)
3. User can filter by date range, agent, channel_type
4. User can view trends over time (charts)

**Entities Involved:**
- `sessions` (aggregated)
- `session_feedback` (aggregated, grouped by feedback_source)

---

## V1 Database Schema

### organizations
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Organization name |
| slug | VARCHAR | URL-friendly identifier (unique) |
| settings | JSONB | General org settings |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

### users
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| email | VARCHAR | Unique per org |
| name | VARCHAR | |
| role | VARCHAR | admin, support |
| is_active | BOOLEAN | |
| last_login_at | TIMESTAMP | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

### agents
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| name | VARCHAR | Display name |
| description | TEXT | Optional description |
| agent_type | VARCHAR | voice (only option for V1) |
| is_active | BOOLEAN | |
| system_prompt | TEXT | Main agent instructions |
| tags | ARRAY | Searchable tags |
| metadata | JSONB | Custom fields |
| created_by | UUID | FK → users |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

### connectors
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Slack, Zendesk, REST API, etc. |
| slug | VARCHAR | **Unique** identifier, used as tool name prefix |
| description | TEXT | |
| connector_type | VARCHAR | api, webhook, database, messaging |
| config_schema | JSONB | Required fields to configure |
| auth_methods | ARRAY | api_key, oauth2, basic, none |
| is_active | BOOLEAN | |
| created_at | TIMESTAMP | |

**Note:** `slug` must be unique and is used to prefix all tools from this connector (e.g., `pizzapalace_add_to_cart`, `zendesk_create_ticket`).

---

### connector_tools
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| connector_id | UUID | FK → connectors |
| name | VARCHAR | Tool display name |
| slug | VARCHAR | URL-friendly identifier |
| description | TEXT | |
| tool_schema | JSONB | OpenAI function calling format |
| connection_config | JSONB | Endpoint URLs, headers, etc. |
| secret_id | UUID | FK → secrets |
| timeout_seconds | INTEGER | Default 30 |
| is_active | BOOLEAN | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

### secrets
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| name | VARCHAR | Secret name |
| secret_type | VARCHAR | api_key, oauth_token, credentials |
| secret_ref | TEXT | KMS reference or encrypted value |
| expires_at | TIMESTAMP | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

---

### agent_connector_tools
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| agent_id | UUID | FK → agents |
| connector_tool_id | UUID | FK → connector_tools |
| is_enabled | BOOLEAN | |
| requires_confirmation | BOOLEAN | Agent must confirm with user before executing |
| created_at | TIMESTAMP | |

---

### sessions
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| agent_id | UUID | FK → agents |
| external_id | VARCHAR | Your system's session ID |
| channel_type | VARCHAR | voice, web, api, slack, widget |
| user_identifier | VARCHAR | External user ID or token |
| user_metadata | JSONB | User context |
| status | VARCHAR | active, completed, escalated, abandoned |
| escalation_ref | VARCHAR | External ticket ID (Zendesk, etc.) |
| started_at | TIMESTAMP | |
| ended_at | TIMESTAMP | |
| metadata | JSONB | |

**channel_type enum:** `voice`, `web`, `api`, `slack`, `widget`, `sms` (V2), `whatsapp` (V2), `email` (V2)

**status enum:** `active`, `completed`, `escalated`, `abandoned`

---

### session_messages
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK → sessions |
| role | VARCHAR | user, assistant, system, tool |
| content | TEXT | Message content (transcript for voice) |
| audio_url | VARCHAR | URL to audio recording |
| audio_duration_ms | INTEGER | Audio length |
| tool_call_id | VARCHAR | For tool role messages |
| tool_name | VARCHAR | Which tool was called |
| tool_input | JSONB | Parameters sent to tool |
| tool_output | JSONB | Result from tool |
| model_used | VARCHAR | Model that generated response |
| tokens_used | INTEGER | Total tokens |
| latency_ms | INTEGER | Response generation time |
| sequence_number | INTEGER | Order in session |
| created_at | TIMESTAMP | |

---

### session_feedback
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK → sessions |
| message_id | UUID | FK → session_messages (optional) |
| rating | INTEGER | 1 = negative, 2 = positive |
| comment | TEXT | Optional feedback text |
| feedback_source | VARCHAR | customer, support, system |
| feedback_ref | VARCHAR | External reference (support user ID, customer ID) |
| feedback_tags | ARRAY | Issue/quality tags |
| user_identifier | VARCHAR | Who gave feedback |
| created_at | TIMESTAMP | |

**feedback_source enum:** `customer`, `support`, `system`

**feedback_tags examples:**
- Negative: `wrong_tool`, `poor_tone`, `hallucination`, `missed_intent`
- Positive: `good_resolution`, `efficient`, `correct_tool_usage`

---

### api_keys
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| name | VARCHAR | Key name |
| key_hash | VARCHAR | SHA-256 of actual key |
| key_prefix | VARCHAR | First chars for identification |
| is_active | BOOLEAN | |
| expires_at | TIMESTAMP | |
| last_used_at | TIMESTAMP | |
| created_by | UUID | FK → users |
| created_at | TIMESTAMP | |

---

## V1 Entity Relationships

```
Organization
    │
    ├── Users
    │
    ├── Secrets
    │
    ├── Agents
    │     ├── AgentConnectorTools → ConnectorTools → Connectors (catalog)
    │     │                              └── Secrets
    │     └── Sessions
    │           ├── SessionMessages
    │           └── SessionFeedback
    │
    └── APIKeys
```

---

## Personas × Permissions Matrix

| Feature | Admin | Support | Customer |
|---------|-------|---------|----------|
| Configure connectors | ✅ | ❌ | ❌ |
| Create/configure agents | ✅ | ❌ | ❌ |
| Link tools to agents | ✅ | ❌ | ❌ |
| Set tool confirmation flag | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Manage API keys | ✅ | ❌ | ❌ |
| View sessions list | ✅ | ✅ | ❌ |
| View session detail | ✅ | ✅ | ❌ |
| Filter sessions | ✅ | ✅ | ❌ |
| Evaluate sessions | ✅ | ✅ | ❌ |
| View analytics | ✅ | ✅ (read-only) | ❌ |
| Interact with agent | ❌ | ❌ | ✅ |
| Provide CSAT | ❌ | ❌ | ✅ |
| Escalate to human | ❌ | ❌ | ✅ |

---
