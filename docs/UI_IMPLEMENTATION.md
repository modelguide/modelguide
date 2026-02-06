# ModelGuide Dashboard — UI Implementation Specification

Complete implementation specification derived from PRD.md, api-spec.md, and DB_SCHEMA.md.

**Design Direction:** "Atmospheric Dark" — see `UI_STRUCTURE.md` for design system.

---

## Table of Contents

1. [Roles & Permissions](#1-roles--permissions)
2. [Authentication](#2-authentication)
3. [Dashboard](#3-dashboard)
4. [Sessions Module](#4-sessions-module)
5. [Agents Module](#5-agents-module)
6. [Connectors Module](#6-connectors-module)
7. [Secrets Module](#7-secrets-module)
8. [Analytics Module](#8-analytics-module)
9. [Settings Module](#9-settings-module)
10. [Implementation Phases](#10-implementation-phases)

---

## 1. Roles & Permissions

### 1.1 User Roles

| Role | Description |
|------|-------------|
| **Admin** | Full access: configure connectors, agents, secrets, manage users, view analytics |
| **Support** | Read-only sessions, can create feedback, view analytics (read-only) |

### 1.2 Permissions Matrix

| Feature | Admin | Support |
|---------|-------|---------|
| View sessions list | Yes | Yes |
| View session detail | Yes | Yes |
| Filter sessions | Yes | Yes |
| Add session feedback | Yes | Yes |
| Configure connectors | Yes | No |
| Create/edit agents | Yes | No |
| Link tools to agents | Yes | No |
| Set tool confirmation flag | Yes | No |
| Manage users | Yes | No |
| Manage API keys | Yes | No |
| Manage secrets | Yes | No |
| View analytics | Yes | Yes (read-only) |

### 1.3 UI Behavior by Role

**Support Role Restrictions:**
- Sidebar hides: Connectors, Secrets, Settings (users tab)
- Agent pages: read-only, no edit/create buttons
- Analytics: no export or filter presets (future)

---

## 2. Authentication

### 2.1 Login Page

**Route:** `/login`

**API:** `POST /api/auth/login`

```json
// Request
{ "email": "admin@example.com", "password": "..." }

// Response (200)
{
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "Alex Admin",
    "role": "admin",
    "organization_id": "uuid"
  },
  "token": "jwt_token"
}

// Response (401)
{ "error": "Invalid credentials" }
```

**UI Behavior:**
- Centered card on dark background
- Logo `{model: guide}` above form
- Email + password fields
- "Sign in" button with loading state
- Error message below button on failure
- Redirect to `/` on success
- Store token in localStorage (Zustand persist)

**Demo Credentials (MSW):**
```
admin@modelguide.ai / admin123 → role: admin
support@modelguide.ai / support123 → role: support
```

### 2.2 Auth State Management

**Store:** `src/stores/auth.ts`

```typescript
interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}
```

### 2.3 Route Protection

- `__root.tsx` checks auth state
- Unauthenticated → redirect to `/login`
- `/login` when authenticated → redirect to `/`

---

## 3. Dashboard

### 3.1 Overview

**Route:** `/` (index)

**Allowed Roles:** Admin, Support

**API:** `GET /api/analytics/summary?from_date=...&to_date=...`

### 3.2 Stats Cards

Display 4 key metrics:

| Metric | Source | Format | Trend |
|--------|--------|--------|-------|
| Total Sessions | `total_sessions` | Number with comma | % change vs previous period |
| Active Sessions | `sessions_by_status.active` | Number | Pulse animation if > 0 |
| Resolution Rate | `resolution_rate` | Percentage | % change |
| CSAT Score | `csat_score` | 1 decimal (e.g., 4.2) | Point change |

**Trend Calculation:**
- Green arrow up: positive change (good for resolution/CSAT, neutral for volume)
- Red arrow down: negative change
- Compare to same period length prior

### 3.3 Recent Sessions Table

**API:** `GET /api/sessions?page=1&page_size=5&sort_by=started_at&sort_order=desc`

**Columns:**
| Column | Field | Format |
|--------|-------|--------|
| Time | `started_at` | HH:MM (relative: "2m ago") |
| Agent | `agent.name` | Text |
| Channel | `channel_type` | Icon (phone/globe/etc) |
| Status | `status` | Badge (color-coded) |
| Duration | computed | Mm Ss (e.g., "4m 32s") |

**Status Badge Colors:**
- `active` → blue, pulse animation
- `completed` → green
- `escalated` → orange
- `abandoned` → red/muted

**Click Row:** Navigate to `/sessions/{id}`

---

## 4. Sessions Module

### 4.1 Sessions List

**Route:** `/sessions`

**Allowed Roles:** Admin, Support

**API:** `GET /api/sessions`

**Query Parameters:**
```typescript
{
  agent_id?: string
  status?: 'active' | 'completed' | 'escalated' | 'abandoned'
  channel_type?: 'voice' | 'web' | 'api' | 'slack' | 'widget' | 'sms' | 'whatsapp'
  has_feedback?: boolean
  feedback_rating?: 'positive' | 'negative'
  feedback_source?: 'customer' | 'support'
  started_after?: string  // ISO date
  started_before?: string // ISO date
  page?: number
  page_size?: number      // default 20
  sort_by?: 'started_at' | 'ended_at' | 'duration'
  sort_order?: 'asc' | 'desc'
}
```

### 4.2 Sessions Table

**Columns:**
| Column | Field | Sortable | Format |
|--------|-------|----------|--------|
| Date/Time | `started_at` | Yes | YYYY-MM-DD HH:MM |
| Agent | `agent.name` | No | Text |
| Channel | `channel_type` | No | Icon + tooltip |
| Status | `status` | No | Badge |
| Duration | computed | Yes | Mm Ss |
| User | `user_identifier` | No | Truncated |
| Feedback | `feedback_summary` | No | Thumbs icon or "—" |

**Channel Icons:**
- `voice` → Phone icon
- `web` → Globe icon
- `api` → Code icon
- `slack` → Slack icon
- `widget` → Chat bubble icon
- `sms` → Message icon
- `whatsapp` → WhatsApp icon

### 4.3 Session Filters

**Filter Bar Components:**

1. **Status Filter** (multi-select dropdown)
   - Options: active, completed, escalated, abandoned
   - Default: all

2. **Channel Filter** (multi-select dropdown)
   - Options: voice, web, api, slack, widget, sms, whatsapp
   - Default: all

3. **Agent Filter** (single-select dropdown)
   - Populated from `GET /api/agents`
   - Options: All Agents, [list of agents]

4. **Date Range** (date picker)
   - From / To date inputs
   - Presets: Today, Last 7 days, Last 30 days, Custom

5. **Feedback Filter** (dropdown)
   - Options: All, Has feedback, No feedback, Positive only, Negative only

**Filter Persistence:** URL query params (shareable links)

### 4.4 Session Detail

**Route:** `/sessions/$id`

**Allowed Roles:** Admin, Support

**API:** `GET /api/sessions/{session_id}`

**Response Structure:**
```typescript
{
  id: string
  external_id: string
  agent: { id: string, name: string }
  channel_type: string
  status: 'active' | 'completed' | 'escalated' | 'abandoned'
  user_identifier: string
  user_metadata: Record<string, any>
  escalation_ref: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number
  metadata: Record<string, any>
  messages: SessionMessage[]
  feedback: SessionFeedback[]
}
```

### 4.5 Session Detail Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Sessions                                             │
├─────────────────────────────────────────────────────────────────┤
│  Session: sess_abc123                                           │
│  ┌──────────────┬──────────────┬──────────────┬───────────────┐ │
│  │ Agent        │ Channel      │ Status       │ Duration      │ │
│  │ Pizza Asst   │ voice        │ ● completed  │ 4m 32s        │ │
│  └──────────────┴──────────────┴──────────────┴───────────────┘ │
│  Started: 2024-01-15 10:42:15 │ Ended: 2024-01-15 10:46:47     │
│  User: user_456 │ External ID: ext_session_789                  │
├─────────────────────────────────────────────────────────────────┤
│  Transcript                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [10:42:15] ASSISTANT                                        ││
│  │ Hi, welcome to Pizza Palace! How can I help you today?      ││
│  │                                                             ││
│  │ [10:42:18] USER                                             ││
│  │ I'd like to order a large pepperoni pizza                   ││
│  │                                                             ││
│  │ [10:42:20] TOOL pizzapalace_add_to_cart                     ││
│  │ ┌─────────────────────────────────────────────────────────┐ ││
│  │ │ Input:                                                  │ ││
│  │ │ { "item": "pizza", "size": "large", "toppings": [...] } │ ││
│  │ │ Output:                                                 │ ││
│  │ │ { "cart_id": "cart_123", "subtotal": 18.99 }            │ ││
│  │ │ Duration: 150ms │ Status: success                       │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  │                                                             ││
│  │ [10:42:21] ASSISTANT                                        ││
│  │ I've added a large pepperoni pizza to your cart...          ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Feedback                                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Customer: 👍 "Great service!"                               ││
│  │ Support: (none)                                             ││
│  │                                        [Add Evaluation]     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 4.6 Message Types

**Role: user**
```typescript
{
  role: 'user'
  content: string           // Transcript text
  audio_url?: string        // Voice playback
  created_at: string
}
```

**Role: assistant**
```typescript
{
  role: 'assistant'
  content: string
  audio_url?: string
  tool_calls?: ToolCall[]   // May include tool calls
  created_at: string
}
```

**Role: tool**
```typescript
{
  role: 'tool'
  tool_call_id: string
  tool_name: string         // e.g., "pizzapalace_add_to_cart"
  tool_input: object
  tool_output: object
  status: 'success' | 'error'
  latency_ms: number
  created_at: string
}
```

### 4.7 Tool Call Display

**Collapsed (default):**
```
[10:42:20] TOOL pizzapalace_add_to_cart ✓ 150ms [▼]
```

**Expanded:**
```
[10:42:20] TOOL pizzapalace_add_to_cart ✓ 150ms [▲]
┌─────────────────────────────────────────────────┐
│ Input:                                          │
│ {                                               │
│   "item": "pizza",                              │
│   "size": "large",                              │
│   "toppings": ["pepperoni"],                    │
│   "quantity": 1                                 │
│ }                                               │
├─────────────────────────────────────────────────┤
│ Output:                                         │
│ {                                               │
│   "cart_id": "cart_123",                        │
│   "item_id": "item_456",                        │
│   "subtotal": 18.99                             │
│ }                                               │
└─────────────────────────────────────────────────┘
```

**Tool Status Indicators:**
- ✓ Green: success
- ✗ Red: error (show error message)
- ⚠ Orange: required confirmation (show `requires_confirmation` badge)

### 4.8 Session Feedback

**Existing Feedback Display:**
- Customer feedback: Show rating (👍/👎) + comment
- Support feedback: Show rating + comment + tags

**Add Evaluation (Support/Admin):**

**API:** `POST /api/sessions/{session_id}/feedback`

```json
{
  "rating": 1,  // 1=negative, 2=positive
  "comment": "Agent used wrong tool",
  "feedback_source": "support",
  "feedback_tags": ["wrong_tool", "missed_intent"]
}
```

**Feedback Form:**
- Thumbs up / Thumbs down toggle
- Comment textarea (optional)
- Tags multi-select:
  - Negative: `wrong_tool`, `poor_tone`, `hallucination`, `missed_intent`, `slow_response`, `failed_tool`
  - Positive: `good_resolution`, `efficient`, `polite`, `correct_tool_usage`

### 4.9 Escalated Sessions

When `status === 'escalated'`:
- Show escalation banner with `escalation_ref`
- If `escalation_ref` looks like a URL or ticket ID, make it a link
- Example: "Escalated to Zendesk ticket #ZD-5678"

---

## 5. Agents Module

### 5.1 Agents List

**Route:** `/agents`

**Allowed Roles:** Admin (full), Support (read-only)

**API:** `GET /api/agents`

**Query Parameters:**
```typescript
{
  is_active?: boolean
  agent_type?: 'voice'
  page?: number
  page_size?: number
}
```

### 5.2 Agents Table

**Columns:**
| Column | Field | Format |
|--------|-------|--------|
| Name | `name` | Text |
| Type | `agent_type` | Badge |
| Status | `is_active` | ● active / ○ inactive |
| Created | `created_at` | YYYY-MM-DD |
| Actions | — | View / Edit / Delete |

**Admin Actions:**
- "Create Agent" button (top right)
- Edit button per row
- Delete button per row (confirmation dialog)

**Support Actions:**
- View only (no buttons)

### 5.3 Create Agent

**Route:** `/agents/new` or modal

**API:** `POST /api/agents`

```json
// Request
{
  "name": "Pizza Palace Assistant",
  "description": "Voice ordering assistant",
  "agent_type": "voice"
}

// Response (201)
{
  "id": "uuid",
  "name": "Pizza Palace Assistant",
  "description": "Voice ordering assistant",
  "agent_type": "voice",
  "is_active": false,
  "api_key": "mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // SHOWN ONCE
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Form Fields:**
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Name | Text | Yes | 1-100 chars |
| Description | Textarea | No | Max 500 chars |
| Agent Type | Select | Yes | Currently only "voice" |

**Post-Creation Modal:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Created Successfully                                     │
│                                                                 │
│  Your API key (shown only once):                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ mgk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6                        ││
│  │                                              [Copy]          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ⚠ Save this key securely. You won't be able to see it again.  │
│                                                                 │
│                                              [Go to Agent →]    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Agent Detail

**Route:** `/agents/$id`

**API:** `GET /api/agents/{agent_id}`

**Sections:**

1. **Header**
   - Name, description
   - Status badge (● active / ○ inactive)
   - Activate / Deactivate button (Admin only)

2. **API Key Section**
   - Display: `mgk_xxxx••••••••••••••••••`
   - Copy prefix button
   - Regenerate button (Admin only, confirmation required)

3. **Assigned Connectors & Tools**
   - List of connector cards
   - Each shows enabled tools with confirmation toggle

### 5.5 Agent API Key

**Regenerate Key:**

**API:** `POST /api/agents/{agent_id}/regenerate-key`

```json
// Response
{
  "api_key": "mgk_yyyyyyyyyyyyyyyyyyyyyyyy",
  "key_prefix": "mgk_yyyy"
}
```

**UI Flow:**
1. Click "Regenerate"
2. Confirmation dialog: "This will invalidate the current key immediately. Continue?"
3. Show new key in modal (same as create flow)
4. Update displayed prefix

### 5.6 Activate/Deactivate

**Activate:** `POST /api/agents/{agent_id}/activate`
**Deactivate:** `POST /api/agents/{agent_id}/deactivate`

**UI:** Toggle button with confirmation for deactivate

### 5.7 Tool Assignment

**Route:** Part of agent detail or `/agents/$id/tools`

**API:**
- `GET /api/agents/{agent_id}/connectors`
- `POST /api/agents/{agent_id}/connectors`
- `PATCH /api/agents/{agent_id}/connectors/{agent_connector_id}`
- `DELETE /api/agents/{agent_id}/connectors/{agent_connector_id}`

**Available Connectors:**
Populated from `GET /api/connectors` (only `is_configured: true`)

**Tool Assignment UI:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Assigned Connectors                                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Medusa (pizzapalace)                              [Remove]  ││
│  │ ┌─────────────────────────────────────────────────────────┐ ││
│  │ │ ☑ add_to_cart                    [ ] Requires confirm   │ ││
│  │ │ ☑ get_cart                       [ ] Requires confirm   │ ││
│  │ │ ☑ create_draft_order             [ ] Requires confirm   │ ││
│  │ │ ☑ confirm_order                  [✓] Requires confirm   │ ││
│  │ │ ☐ cancel_order                   [✓] Requires confirm   │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [+ Add Connector]                                              │
└─────────────────────────────────────────────────────────────────┘
```

**Add Connector Flow:**
1. Click "Add Connector"
2. Select from available (configured) connectors
3. All tools enabled by default
4. `requires_confirmation` defaults from `connector_tools.default_requires_confirmation`
5. Save creates `agent_connector_tools` records

**Tool Naming:**
- Display: Tool name only (e.g., "add_to_cart")
- Full MCP name: `{connector.slug}_{tool.slug}` (e.g., "pizzapalace_add_to_cart")

---

## 6. Connectors Module

### 6.1 Connectors List

**Route:** `/connectors`

**Allowed Roles:** Admin only

**API:** `GET /api/connectors`

### 6.2 Connector Card Grid

```
┌─────────────────────────────────────────────────────────────────┐
│  Connectors                                                     │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ 🛒 Medusa        │  │ 🎫 Zendesk       │  │ 📅 Calendly    │ │
│  │ E-commerce       │  │ Support tickets  │  │ Scheduling     │ │
│  │                  │  │                  │  │                │ │
│  │ ● Configured     │  │ ○ Not configured │  │ ○ Not config.  │ │
│  │ 8 tools          │  │ 5 tools          │  │ 3 tools        │ │
│  │                  │  │                  │  │                │ │
│  │ [Configure →]    │  │ [Configure →]    │  │ [Configure →]  │ │
│  └──────────────────┘  └──────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Card Elements:**
- Icon (from `icon_url` or default by type)
- Name (from catalog)
- Description (truncated)
- Status: ● Configured (green) / ○ Not configured (gray)
- Tool count
- Configure button

**Configured Status:**
Computed: All required fields in `config_schema` have non-null values in `config`

### 6.3 Connector Detail / Config

**Route:** `/connectors/$id`

**API:** `GET /api/connectors/{connector_id}`

**Response includes:**
```typescript
{
  id: string
  name: string                    // From catalog
  title: string
  description: string
  connector_type: 'api' | 'webhook' | 'database' | 'messaging'
  config: {
    [field: string]: {
      type: 'string' | 'secret'
      description?: string
      required: boolean
      value: string | null        // null if not set
      value_id?: string           // For secrets: UUID reference
    }
  }
  is_configured: boolean
  tools: ConnectorTool[]
}
```

### 6.4 Connector Configuration Form

**API:** `PATCH /api/connectors/{connector_id}`

```json
// Request
{
  "config": {
    "base_url": "https://api.pizzapalace.com",
    "api_token": "secret-uuid"  // UUID of secret
  }
}
```

**Dynamic Form Generation:**

For each field in `config_schema`:

| Field Type | UI Component |
|------------|--------------|
| `string` (required: true) | Text input, required |
| `string` (required: false) | Text input, optional |
| `secret` | Secret selector dropdown |

**Secret Selector:**
- Dropdown populated from `GET /api/secrets`
- Option to "Create new secret" (opens modal)
- Shows secret name, not value

**Form Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Configure Medusa                                               │
│                                                                 │
│  Base URL *                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ https://api.pizzapalace.com                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│  Medusa API base URL                                            │
│                                                                 │
│  Publishable Key                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ pk_live_xxxxx                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  API Token *                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Select secret...                                        ▼  ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │ Medusa Production Token                                     ││
│  │ Medusa Staging Token                                        ││
│  │ ─────────────────────────────────────────────────────────── ││
│  │ + Create new secret                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│                          [Cancel]  [Save Configuration]         │
└─────────────────────────────────────────────────────────────────┘
```

### 6.5 Health Check

**API:** `POST /api/connectors/{connector_id}/health-check`

```json
// Response (200)
{
  "status": "healthy",
  "message": "Connection successful",
  "checked_at": "2024-01-01T00:00:00Z"
}

// Response (error)
{
  "status": "unhealthy",
  "message": "Connection refused",
  "checked_at": "2024-01-01T00:00:00Z"
}
```

**UI:**
- "Test Connection" button
- Loading spinner while testing
- Success: Green checkmark + message
- Error: Red X + error message

### 6.6 Connector Tools List

Display tools from `connector.tools`:

```
┌─────────────────────────────────────────────────────────────────┐
│  Available Tools                                                │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ add_to_cart              │ Add item to cart     │ ○ Conf  │  │
│  │ get_cart                 │ Get cart contents    │ ○ Conf  │  │
│  │ create_draft_order       │ Create draft order   │ ○ Conf  │  │
│  │ confirm_order            │ Place order          │ ● Conf  │  │
│  │ cancel_order             │ Cancel an order      │ ● Conf  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ● = Requires confirmation by default                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Secrets Module

### 7.1 Secrets List

**Route:** `/secrets`

**Allowed Roles:** Admin only

**API:** `GET /api/secrets`

### 7.2 Secrets Table

**Columns:**
| Column | Field | Format |
|--------|-------|--------|
| Name | `name` | Text |
| Created | `created_at` | YYYY-MM-DD |
| Updated | `updated_at` | YYYY-MM-DD |
| Actions | — | Edit / Delete |

**Note:** Secret values are NEVER displayed

### 7.3 Create Secret

**API:** `POST /api/secrets`

```json
// Request
{
  "name": "Medusa Production Token",
  "value": "sk_live_xxxxxxxxxxxxx"
}

// Response (201)
{
  "id": "uuid",
  "name": "Medusa Production Token",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Form:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Create Secret                                                  │
│                                                                 │
│  Name *                                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Medusa Production Token                                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Value *                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ••••••••••••••••••••••••••••                           [👁] ││
│  └─────────────────────────────────────────────────────────────┘│
│  This value will be encrypted and cannot be retrieved later.    │
│                                                                 │
│                                       [Cancel]  [Create Secret] │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Update Secret

**API:** `PATCH /api/secrets/{secret_id}`

```json
{
  "name": "Updated Name",      // optional
  "value": "new_secret_value"  // optional
}
```

**Form:**
- Name field (editable)
- Value field (empty, type new value to replace)
- Warning: "Enter a new value to replace the existing secret"

### 7.5 Delete Secret

**API:** `DELETE /api/secrets/{secret_id}`

**Confirmation Dialog:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Delete Secret                                                  │
│                                                                 │
│  Are you sure you want to delete "Medusa Production Token"?     │
│                                                                 │
│  ⚠ This may break connectors using this secret.                 │
│                                                                 │
│                                        [Cancel]  [Delete]       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Analytics Module

### 8.1 Analytics Dashboard

**Route:** `/analytics`

**Allowed Roles:** Admin, Support (read-only)

**API:** `GET /api/analytics/summary`

### 8.2 Summary Metrics

**API Response:**
```typescript
{
  period: { from: string, to: string }
  total_sessions: number
  sessions_by_status: {
    completed: number
    escalated: number
    abandoned: number
    active: number
  }
  sessions_by_channel: {
    voice: number
    web: number
    api: number
    // etc.
  }
  resolution_rate: number        // 0-1
  escalation_rate: number        // 0-1
  abandonment_rate: number       // 0-1
  avg_duration_seconds: number
  csat_score: number             // 1-2 scale
  support_evaluation_score: number
  feedback_count: {
    customer: number
    support: number
  }
}
```

### 8.3 Metrics Display

**Key Metrics Cards:**
| Metric | Display | Format |
|--------|---------|--------|
| Total Sessions | Large number | 1,234 |
| Resolution Rate | Percentage | 87.2% |
| Escalation Rate | Percentage | 10.1% |
| Abandonment Rate | Percentage | 2.7% |
| Avg Duration | Time | 7m 15s |
| CSAT Score | Score | 1.85 / 2 |
| Support Score | Score | 1.72 / 2 |

### 8.4 Trends Chart

**API:** `GET /api/analytics/trends`

**Parameters:**
```typescript
{
  metric: 'sessions' | 'csat' | 'resolution_rate' | 'escalation_rate' | 'duration'
  granularity: 'hour' | 'day' | 'week' | 'month'
  from_date: string
  to_date: string
  agent_id?: string
  channel_type?: string
}
```

**Chart Options:**
- Line chart for trends over time
- Metric selector dropdown
- Granularity selector (hour/day/week/month)

### 8.5 Breakdown Charts

**Sessions by Status (Donut):**
- Completed (green)
- Escalated (orange)
- Abandoned (red)
- Active (blue)

**Sessions by Channel (Bar):**
- Horizontal bars
- One bar per channel type
- Sorted by volume

### 8.6 Analytics Filters

- Date range picker (required)
- Agent filter (optional)
- Channel filter (optional)

---

## 9. Settings Module

### 9.1 Settings Page

**Route:** `/settings`

**Allowed Roles:** Admin (full), Support (profile only)

### 9.2 Settings Tabs

| Tab | Admin | Support |
|-----|-------|---------|
| Profile | Yes | Yes |
| Appearance | Yes | Yes |
| Users | Yes | No |

### 9.3 Profile Tab

**Fields:**
- Name (editable)
- Email (read-only)
- Role (read-only badge)

### 9.4 Appearance Tab

**Theme Toggle:**
- Dark mode (default)
- Light mode
- System preference

**Persisted:** localStorage

### 9.5 Users Tab (Admin Only)

**API:** `GET /api/users` (not yet specified, future)

**Table:**
| Column | Field |
|--------|-------|
| Name | `name` |
| Email | `email` |
| Role | `role` |
| Status | `is_active` |
| Last Login | `last_login_at` |
| Actions | Edit / Deactivate |

---

## 10. Implementation Phases

### Phase 1: Design System & Layout Shell

**Goal:** App shell with navigation

**Tasks:**
- [ ] Design system CSS variables in `app.css`
- [ ] `cn()` utility function
- [ ] Base UI components: Button, Card, Input, Badge, Avatar
- [ ] Layout components: Logo, Sidebar, Header, PageContainer, AppShell
- [ ] Route protection in `__root.tsx`
- [ ] Placeholder routes for all pages

### Phase 2: Auth & MSW Setup

**Goal:** Working login flow

**Tasks:**
- [ ] MSW initialization
- [ ] Auth handlers and mock data
- [ ] Zustand auth store with persist
- [ ] Login page and form
- [ ] Logout functionality

### Phase 3: Dashboard

**Goal:** Dashboard with stats

**Tasks:**
- [ ] Stats mock data and handlers
- [ ] StatCard component
- [ ] StatsGrid component
- [ ] RecentSessions component
- [ ] Dashboard page integration

### Phase 4: Sessions Module

**Goal:** Full session browsing

**Tasks:**
- [ ] Sessions schema (Zod)
- [ ] Sessions mock data (20+ varied)
- [ ] Sessions handlers
- [ ] SessionsTable with sorting
- [ ] SessionFilters component
- [ ] SessionDetail page
- [ ] TranscriptMessage component
- [ ] ToolCallBlock (expandable)
- [ ] FeedbackForm component

### Phase 5: Agents Module

**Goal:** Agent management

**Tasks:**
- [ ] Agents schema
- [ ] Agents mock data
- [ ] Agents handlers
- [ ] AgentsTable
- [ ] AgentForm (create/edit)
- [ ] AgentDetail page
- [ ] ApiKeyDisplay component
- [ ] ToolAssignment component

### Phase 6: Connectors Module

**Goal:** Connector configuration

**Tasks:**
- [ ] Connectors schema
- [ ] Connectors mock data (3 types)
- [ ] Connectors handlers
- [ ] ConnectorsGrid
- [ ] ConnectorCard
- [ ] ConnectorConfigForm (dynamic)
- [ ] HealthCheckButton
- [ ] SecretSelector component

### Phase 7: Secrets Module

**Goal:** Secrets CRUD

**Tasks:**
- [ ] Secrets schema
- [ ] Secrets mock data
- [ ] Secrets handlers
- [ ] SecretsTable
- [ ] SecretForm
- [ ] DeleteDialog

### Phase 8: Analytics Module

**Goal:** Analytics with charts

**Tasks:**
- [ ] Add chart library
- [ ] Analytics schema
- [ ] Analytics mock data
- [ ] Analytics handlers
- [ ] AnalyticsSummary
- [ ] TrendChart
- [ ] StatusBreakdown (donut)
- [ ] ChannelBreakdown (bar)
- [ ] AnalyticsFilters

### Phase 9: Settings & Polish

**Goal:** Production ready

**Tasks:**
- [ ] ProfileForm
- [ ] AppearanceSettings
- [ ] UsersTable (Admin)
- [ ] Loading skeletons
- [ ] Error boundaries
- [ ] Empty states
- [ ] Mobile responsive
- [ ] Test coverage

---

## Quick Reference

### API Base URL
```
/api
```

### Authentication Header
```
Authorization: Bearer <jwt_token>
```

*Organization context is derived from the JWT token claims.*

### Common Response Formats

**List Response:**
```json
{
  "items": [...],
  "total": 150,
  "page": 1,
  "page_size": 20
}
```

**Error Response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": { ... }
  }
}
```

### File Conventions

- Components: `kebab-case.tsx`
- Hooks: `use-kebab-case.ts`
- Schemas: `kebab-case.ts`
- Routes: `name.tsx` or `name.$param.tsx`
- Stores: `kebab-case.ts`

### Import Alias

`~/` → `./src/`
