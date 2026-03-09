# Deploying to Pipecat Cloud

## Prerequisites

- [Pipecat Cloud CLI](https://docs.pipecat.daily.co/pipecat-cloud/cli) installed
- A Pipecat Cloud account with a project set up
- All required API keys

## Steps

### 1. Authenticate

```bash
pipecat auth login
```

### 2. Set environment variables

Configure secrets in Pipecat Cloud (these are not committed to the repo):

```bash
pipecat secrets set DAILY_API_KEY "your-daily-key"
pipecat secrets set OPENAI_API_KEY "sk-your-openai-key"
pipecat secrets set DEEPGRAM_API_KEY "your-deepgram-key"
pipecat secrets set ELEVENLABS_API_KEY "your-elevenlabs-key"
pipecat secrets set ELEVENLABS_VOICE_ID "your-voice-id"
pipecat secrets set MODELGUIDE_API_URL "https://your-modelguide-api.up.railway.app"
pipecat secrets set MODELGUIDE_API_KEY "mgk_your-agent-key"
pipecat secrets set MODELGUIDE_AGENT_ID "agt_xxx"
```

### 3. Deploy

```bash
pipecat deploy
```

This reads `pipecat.yaml` and builds + deploys the agent.

### 4. Connect

Once deployed, Pipecat Cloud provides a WebRTC endpoint. You can connect to it from:

- The Pipecat Cloud dashboard (built-in test UI)
- A custom web app using the [Daily.co client SDK](https://docs.daily.co/reference)
- The Daily Prebuilt embed

### Daily.co room configuration

For production, configure your Daily.co domain with:
- **Room expiry:** Set `exp` to auto-expire rooms after a reasonable duration (e.g. 30 minutes)
- **Privacy:** Set `privacy: "private"` and use meeting tokens for authenticated access
- **Recording:** Enable cloud recording if you want audio archives

### Connecting to ModelGuide API

The `MODELGUIDE_API_URL` must be reachable from wherever Pipecat Cloud runs your agent. If your ModelGuide API is on Railway:

1. Use the public Railway URL (e.g. `https://modelguide-api-production.up.railway.app`)
2. Ensure the agent's API key (`mgk_xxx`) is valid and the agent has the required connector tools assigned

There is no need for webhook configuration (unlike the ElevenLabs integration). The Pipecat agent calls ModelGuide's REST and MCP APIs directly.
