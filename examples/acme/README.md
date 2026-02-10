# Acme Corp Demo

Session-aware ElevenLabs voice agent integration with ModelGuide.

## Setup

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/webhooks` to `http://localhost:3000` (ModelGuide API).

## Usage

1. Start the ModelGuide API (`make api-dev`) — runs on `http://localhost:3000`
2. Expose the API with zrok so ElevenLabs can reach your webhooks:
   ```bash
   zrok share public http://localhost:3000
   ```
   Copy the `https://xxxx.share.zrok.io` URL.
3. Configure your ElevenLabs agent with the ngrok URL:
   - **MCP Endpoint:** `https://xxxx.share.zrok.io/mcp/{agentId}`
   - **Post-Call Webhook:** `https://xxxx.share.zrok.io/webhooks/elevenlabs/{agentId}/post-call`
   - **Dynamic variable placeholders:** `mg_api_key`, `mg_session_id`, `mg_user_id`
4. Start this demo (`npm run dev`) — opens at `http://localhost:5173`
5. Enter your ModelGuide API key (`mgk_...`) and ElevenLabs Agent ID
6. Click **Start Call** — this creates a session in ModelGuide, then starts the ElevenLabs conversation with `mg_session_id` as a dynamic variable
7. After the call ends, the post-call webhook updates the existing session with the transcript

## Flow

1. **Landing page** → `POST /api/sessions` → gets `session_id`
2. **ElevenLabs widget** starts with `dynamicVariables: { mg_api_key, mg_session_id, mg_user_id }`
3. **During call** → tool calls go through the MCP endpoint (`/mcp/:agentId`)
4. **After call** → post-call webhook (`/webhooks/elevenlabs/:agentId/post-call`) updates existing session with transcript + metadata
