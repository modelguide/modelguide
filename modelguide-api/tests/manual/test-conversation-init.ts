/**
 * Manual test: simulate an ElevenLabs conversation-init webhook call.
 *
 * Sends a POST to the conversation-init endpoint with a test payload,
 * authenticated via the agent's API key. Run a second time with the
 * same call_sid to verify idempotency (should return the same session).
 *
 * Required env vars (or set in tests/manual/.env):
 *   MG_BASE_URL   — e.g. http://localhost:3000
 *   MG_AGENT_ID   — agent UUID
 *   MG_API_KEY    — agent API key (mgk_xxx)
 *
 * Usage:
 *   bun run tests/manual/test-conversation-init.ts
 *
 *   # With custom caller info:
 *   bun run tests/manual/test-conversation-init.ts --caller=+1234567890 --call-sid=CA_test_001
 *
 *   # Test idempotency (re-run with same call_sid):
 *   bun run tests/manual/test-conversation-init.ts --call-sid=CA_test_001
 */

import { resolve } from "node:path";

// Load .env from tests/manual/.env
const envPath = resolve(import.meta.dir, ".env");
await Bun.file(envPath)
  .text()
  .then((text) => {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  })
  .catch(() => {
    console.warn(
      "No tests/manual/.env found, falling back to exported env vars",
    );
  });

const BASE_URL = requireEnv("MG_BASE_URL");
const AGENT_ID = requireEnv("MG_AGENT_ID");
const API_KEY = requireEnv("MG_API_KEY");

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// Parse CLI args
const args = process.argv.slice(2);
let callerId = "+15551234567";
let calledNumber = "+15559876543";
let callSid = `CA_test_${Date.now()}`;
let conversationId = `conv_${Date.now()}`;

for (const arg of args) {
  if (arg.startsWith("--caller=")) callerId = arg.slice("--caller=".length);
  if (arg.startsWith("--called=")) calledNumber = arg.slice("--called=".length);
  if (arg.startsWith("--call-sid=")) callSid = arg.slice("--call-sid=".length);
  if (arg.startsWith("--conversation-id="))
    conversationId = arg.slice("--conversation-id=".length);
}

// Build payload (simulates what ElevenLabs sends)
const payload = {
  conversation_id: conversationId,
  caller_id: callerId,
  called_number: calledNumber,
  call_sid: callSid,
  agent_id: `el_agent_${AGENT_ID.slice(0, 8)}`,
};

const url = `${BASE_URL}/webhooks/elevenlabs/${AGENT_ID}/conversation-init`;

console.log(`=== POST ${url} ===`);
console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
console.log(`API Key: ${API_KEY.slice(0, 8)}...`);
console.log();

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-mg-api-key": API_KEY,
  },
  body: JSON.stringify(payload),
});

const body = await res.text();
console.log(`Status: ${res.status}`);
try {
  const json = JSON.parse(body);
  console.log("Response:", JSON.stringify(json, null, 2));

  if (json.dynamic_variables?.mg_session_id) {
    console.log(`\nSession ID: ${json.dynamic_variables.mg_session_id}`);
    console.log(
      `\nTip: Run again with --conversation-id=${conversationId} to test idempotency`,
    );
  }
} catch {
  console.log("Response:", body);
}

process.exit(res.ok ? 0 : 1);
