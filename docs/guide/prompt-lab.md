# Prompt Lab — Test a prompt against the live worker

The Prompt Lab is a POC surface on the agent detail page that lets you
iterate on a voice agent's system prompt against the deployed LiveKit
worker, without redeploying.

> **Status:** POC. See [ADR-015](../decisions/015-prompt-lab-poc.md) for the
> design decisions and trade-offs. The standard **Talk to agent** button
> (ADR-014) is unchanged and remains the right tool for production parity
> checks.

## When to use it

| You want to… | Surface |
|---|---|
| Hear how the deployed worker sounds with its current production prompt | **Talk to agent** (ADR-014) |
| Iterate on a prompt edit and hear it in 5 seconds, not 5 minutes | **Prompt Lab** (this page) |
| Verify a freshly-compiled prompt before promoting | **Prompt Lab** then redeploy |
| Run a regression suite on a prompt change | Eval suites (out of scope here) |

## What it does, in one sentence

The Prompt Lab dispatches the **same deployed worker** as the standard
voice test, but adds `prompt_override` to the dispatch metadata. The
worker uses that string as the agent's instructions for that single
session, then forgets it when the room closes.

## Quick start

1. Open the agent detail page (`/agents/<id>`) for a LiveKit voice agent.
2. Scroll to the **Prompt Lab** card.
3. The textarea is seeded with the agent's last compiled prompt
   (`compiledInstructions`). If the agent has never been compiled, the
   textarea starts empty.
4. Edit the prompt freely.
5. Click **Sync & Talk**.
   - The browser checks for mic permission.
   - The API creates a fresh session, dispatches the worker with your
     prompt in metadata, mints a short-lived LiveKit token.
   - The room mounts via WebRTC and the agent greets you using your
     edited prompt.
6. Talk to the agent. When you're done, click **Hang up**.
7. The session lands in the normal **Sessions** view (look for the
   timestamp that matches when you hit Sync & Talk).

## Compile flow (optional)

The Prompt Lab textarea is a free-form editor — paste anything you want.
If you want to test a SOP-derived prompt, hit `POST /api/agents/:id/compile`
first (or use the existing **Compile** UI), refresh the page, and the
freshly compiled prompt seeds the textarea.

We deliberately did not add an in-panel "compile" button — the existing
compile UI already lives next door on the same page. Adding a second
trigger would just be two ways to do the same thing.

## Limits

- **Prompt size:** 50 KB UTF-8 (any larger gets a 400 from the API).
  The textarea shows the current size in characters; the server cap is
  in bytes.
- **Permissions:** admin-only (same as the standard voice test —
  `agents:activate`).
- **Worker requirement:** the agent must have `agentPlatform === "livekit"`,
  a configured `metadata.livekit.{url, agentName}`, and the
  `livekit_api_key` + `livekit_api_secret` secrets present. Otherwise
  the panel renders a warning and disables the action.
- **No persistence:** your edit is held in the browser only. Refresh the
  page and it's gone (back to the seeded compiled prompt). If you want
  to keep a prompt, paste it somewhere durable.

## What gets logged

A Prompt Lab session is a normal MG session — it shows up in the
session list with `channelType = "voice"` and `userMetadata.voiceTest =
true`. The injected prompt is **not** stored on the session row; only
the conversation transcript lands in the dashboard.

If you need to know "did this session use a Prompt Lab override?", check
for the worker-side log line:

```
Prompt Lab override active (N chars) — skipping baked-in profile prompt
```

(this is the breadcrumb the worker logs in `agent.py` when it sees
`prompt_override` in the dispatch metadata).

## Promoting a prompt

There is no "promote" button. The intended path:

1. Iterate in Prompt Lab until you're happy.
2. Copy the prompt out.
3. Update the SOP / worker profile prompt source.
4. Recompile / redeploy as usual.
5. Verify with the standard **Talk to agent** button.

We deliberately did not wire a one-click "ship this" — the production
path goes through the compiler so we get versioning, diffs, and CI.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Button greyed out, "Configure the LiveKit URL…" warning | LiveKit not configured on the agent. Set it up first. |
| Button greyed out, no warning | Textarea is empty / whitespace. Type something. |
| Click does nothing, error "Microphone permission denied" | The browser blocked mic access. Allow it in your browser's site settings. |
| Click → "Joining LiveKit room…" forever | Worker is offline, or `agentName` in agent metadata doesn't match the worker's profile registry. Check the worker logs. |
| Agent greets you, then ignores your prompt edit | Worker is on an older image without the `prompt_override` code path. Redeploy the worker. |
| 400 from the API | Most likely the prompt is over the 50 KB cap, or LiveKit isn't fully configured. The error body has the details. |

## Related

- [ADR-014](../decisions/014-browser-voice-testing.md) — parent feature
  (browser voice testing, no override).
- [ADR-015](../decisions/015-prompt-lab-poc.md) — this POC's design.
- `examples/agents/livekit-agent/README.md` — worker-side override
  implementation.
