# ADR-011: LiveKit Outbound Calls

**Status:** Accepted

## Context

ModelGuide agents previously only handled inbound interactions — a customer initiates a session via web chat, voice widget, or API. For proactive outreach (appointment reminders, order updates, support follow-ups), we need agents to place outbound phone calls from the dashboard.

Requirements:
- Admin clicks "Make Call" on an agent's detail page, enters a phone number, and the agent dials out
- Calls go through PSTN via SIP trunking (Twilio)
- LiveKit Cloud orchestrates the media and agent dispatch
- Credentials are per-agent, not platform-wide, since orgs may have multiple agents with different LiveKit projects
- The call creates a session so transcripts and feedback flow through the existing pipeline

Alternatives considered:
- **Platform-level LiveKit config** (single set of credentials for the whole org): rejected because orgs may deploy multiple LiveKit projects, and per-agent config follows the existing connector secrets pattern
- **Direct Twilio SIP from the API**: rejected because LiveKit already handles media routing, STT/TTS, and agent lifecycle — going direct would duplicate infrastructure
- **WebRTC browser-to-agent calls**: deferred — outbound PSTN is the immediate need; browser calls can reuse the same LiveKit room infrastructure later

## Decision

### Architecture

```
Dashboard → API (POST /agents/:id/outbound-call)
  → createSession(channel: "phone", direction: "outbound")
  → dispatchAgentToRoom(roomName, agentName, metadata)
  → Agent joins room, reads dispatch metadata
  → Agent creates SIP participant (sip_call_to: phoneNumber)
  → Twilio SIP trunk dials out
  → Transcript flows back through session messages
```

### Per-agent LiveKit credentials

Each agent stores LiveKit config in two places:
- **`metadata.livekit`** — non-secret config: `{ url, agentName }`. The `url` is the LiveKit Cloud WebSocket URL, `agentName` is the registered agent name for dispatch.
- **`secrets` map** — `livekit_api_key` and `livekit_api_secret` reference UUIDs in the org secrets vault (AES-256-GCM encrypted, same as connector secrets).

This follows the connector secrets pattern: config in metadata, credential references in the secrets map, actual values in the vault.

### API endpoints

| Endpoint | Permission | Purpose |
|----------|------------|---------|
| `PUT /agents/:id/livekit-config` | `agents:activate` | Save LiveKit URL, agent name, and secret references |
| `POST /agents/:id/livekit-ping` | `agents:activate` | Test LiveKit credentials by calling `listRooms()` |
| `POST /agents/:id/outbound-call` | `agents:activate` | Create session + dispatch agent to make the call |

All three use `agents:activate` permission since they involve agent runtime operations.

### Agent-side dispatch protocol

The API dispatches the agent to a LiveKit room with metadata:

```json
{
  "direction": "outbound",
  "phoneNumber": "+14155551234",
  "customerName": "Jane Doe",
  "sessionId": "sess_xxx"
}
```

The agent reads `direction` from dispatch metadata. For `outbound`, it creates a SIP participant to dial out rather than waiting for an inbound caller. The `SIP_OUTBOUND_TRUNK_ID` env var on the agent identifies which Twilio trunk to use.

### CLI support

The `mg add-agents` and `mg setup` commands accept LiveKit agents in YAML:

```yaml
agents:
  - name: GlowBox Voice Agent
    slug: glowbox-voice
    platform: livekit
    config:
      url: wss://my-project.livekit.cloud
      agentName: glowbox-voice-agent
    secrets:
      - field: livekit_api_key
        name: LiveKit API Key
        type: api_key
      - field: livekit_api_secret
        name: LiveKit API Secret
        type: credentials
```

The CLI creates secrets first, then passes the secret IDs and config metadata to `createAgent()`.

## Consequences

### Positive
- Agents can make outbound calls without additional infrastructure — reuses LiveKit Cloud, existing session pipeline, and the secrets vault
- Per-agent credentials allow multi-project setups and credential rotation without affecting other agents
- Session-backed calls get transcripts, feedback, and analytics for free
- CLI provisioning enables scripted setup of LiveKit agents with secrets

### Negative
- LiveKit credentials are not validated against the vault at config time (the secret IDs are stored as references without checking existence) — a ping test catches this but it's not enforced on save
- The dispatch protocol couples the API and agent via metadata conventions — changes to the metadata schema require coordinated deployment
- `completed` call phase in the UI dialog is scaffolded but not wired — requires WebSocket session status tracking in a follow-up

### Future work
- Phone number E.164 validation on the `outbound-call` endpoint
- Orphaned secret cleanup when agent creation fails in CLI (match connector pattern)
- Browser-to-agent WebRTC calls reusing the same LiveKit room infrastructure
- `--verify` flag for CLI to auto-ping LiveKit after agent creation
