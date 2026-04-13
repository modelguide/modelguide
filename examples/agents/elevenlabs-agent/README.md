# ElevenLabs Agent Management Utility

CLI script for ad-hoc inspection and configuration of ElevenLabs Conversational AI agents. Useful during development to view or modify agent settings directly via the ElevenLabs API.

> **For production setup**, use the ModelGuide UI sync flow instead. See [docs/elevenlabs-setup.md](../../../docs/elevenlabs-setup.md).

## Setup

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key |
| `MG_API_KEY` | ModelGuide agent API key (`mgk_...`) |
| `WEBHOOK_BASE_URL` | Public URL where ModelGuide is reachable (e.g. ngrok URL) |

Install dependencies:

```bash
bun install
```

## Commands

```bash
# Fetch current agent config → saves to get-agent-output.json
bun run manage-agent.ts get

# Push updated agent configuration (webhook URL, API key)
bun run manage-agent.ts update
```

## Notes

- Requires [Bun](https://bun.sh) runtime
- The agent ID is read from the script — edit `manage-agent.ts` to change it
- `get` output is saved to `get-agent-output.json` for inspection
