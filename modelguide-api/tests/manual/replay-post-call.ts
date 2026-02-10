/**
 * Manual test: replay a saved ElevenLabs post-call webhook payload.
 *
 * The webhook route dumps payloads to /tmp/elevenlabs-post-call-*.json
 * in development mode. This script replays one of those files against
 * the local webhook endpoint with HMAC verification skipped.
 *
 * Required env vars:
 *   MG_BASE_URL   — e.g. http://localhost:3000
 *   MG_AGENT_ID   — agent UUID
 *
 * Usage:
 *   bun run tests/manual/replay-post-call.ts <path-to-payload.json>
 *
 *   # or replay the latest dump automatically:
 *   bun run tests/manual/replay-post-call.ts --latest
 */

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// Resolve payload file path: CLI arg > env var > latest tmp dump
let payloadPath = process.argv[2];

if (!payloadPath || payloadPath === "--latest") {
  const payloadFromEnv = process.env.MG_POSTCALL_PAYLOAD;

  if (payloadFromEnv) {
    payloadPath = resolve(payloadFromEnv);
    console.log(`Using payload from MG_POSTCALL_PAYLOAD: ${payloadPath}`);
  } else {
    // Find the latest dump in /tmp
    const prefix = `elevenlabs-post-call-${AGENT_ID}-`;
    const files = readdirSync(tmpdir())
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.error(
        `No payload dumps found in ${tmpdir()} for agent ${AGENT_ID}.\nSet MG_POSTCALL_PAYLOAD in .env or ensure the API has received a webhook in dev mode.`,
      );
      process.exit(1);
    }

    payloadPath = join(tmpdir(), files[0]);
    console.log(`Using latest dump: ${payloadPath}`);
  }
} else {
  payloadPath = resolve(payloadPath);
}

// Read payload
const rawBody = await Bun.file(payloadPath).text();
console.log(`Payload size: ${rawBody.length} bytes`);

// Send to webhook endpoint with HMAC skip header
const url = `${BASE_URL}/webhooks/elevenlabs/${AGENT_ID}/post-call`;
console.log(`\n=== POST ${url} ===`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-skip-hmac": "true",
  },
  body: rawBody,
});

const body = await res.text();
console.log(`Status: ${res.status}`);
try {
  console.log("Response:", JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log("Response:", body);
}

process.exit(res.ok ? 0 : 1);
