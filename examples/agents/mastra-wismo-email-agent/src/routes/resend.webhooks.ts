import { convert } from "html-to-text";
import { Webhook } from "svix";
import { Hono } from "hono";
import { z } from "zod";
import { extractEmailAddress, sendEmail, stripQuotedReply } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { createSession, patchSessionStatus, postUserMessage } from "../lib/modelguide.client.js";
import { runWismoAgent } from "../mastra/agents/wismo.js";
import { config, isDev } from "../config.js";

// Resend email.received webhook — body is NOT included, must be fetched separately
const resendWebhookPayloadSchema = z.object({
  type: z.literal("email.received"),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    created_at: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string(),
    // message_id may be absent in the webhook; fetched email has it
    message_id: z.string().optional(),
  }),
});

export const webhookRouter = new Hono();

// Deduplicate webhook deliveries — Svix retries if we don't respond within its
// timeout, but agent execution takes 10-30s. Track processed email_ids so retries
// are rejected immediately. Entries expire after 1 hour to prevent unbounded growth.
const DEDUP_TTL_MS = 60 * 60 * 1000;
const processedEmails = new Map<string, number>();

function dedup(emailId: string): boolean {
  const now = Date.now();
  // Lazy cleanup on every call — cheap at low volume
  for (const [id, ts] of processedEmails) {
    if (now - ts > DEDUP_TTL_MS) processedEmails.delete(id);
  }
  if (processedEmails.has(emailId)) return false;
  processedEmails.set(emailId, now);
  return true;
}

webhookRouter.post("/", async (c) => {
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: "Failed to read request body" }, 400);
  }

  if (!isDev) {
    // Resend signs webhooks via Svix. Verification must use the raw request body —
    // parsing JSON and re-stringifying it breaks the signature even if the content
    // is identical. See: https://docs.svix.com/receiving/verifying-payloads/how
    const wh = new Webhook(config.RESEND_WEBHOOK_SECRET!);
    try {
      wh.verify(rawBody, {
        "svix-id": c.req.header("svix-id") ?? "",
        "svix-timestamp": c.req.header("svix-timestamp") ?? "",
        "svix-signature": c.req.header("svix-signature") ?? "",
      });
    } catch {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parseResult = resendWebhookPayloadSchema.safeParse(body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, "Invalid webhook payload");
    return c.json({ error: "Invalid payload" }, 400);
  }

  const { email_id, to: webhookTo } = parseResult.data.data;

  // Reject duplicate webhook deliveries (Svix retries on timeout)
  if (!dedup(email_id)) {
    logger.info({ email_id }, "Duplicate webhook delivery — skipping");
    return c.json({ skipped: true, reason: "duplicate" });
  }

  // Early inbox filter — use the to field from the webhook payload so we can skip
  // before making any downstream API calls (Resend fetch, ModelGuide, MCP).
  const inboxEmail = config.INBOX_EMAIL.toLowerCase();
  const recipientMatch = webhookTo.some((addr) => {
    const { email } = extractEmailAddress(addr);
    return email.toLowerCase() === inboxEmail;
  });

  if (!recipientMatch) {
    logger.info({ email_id, to: webhookTo, inboxEmail }, "Email not addressed to inbox — skipping");
    return c.json({ skipped: true });
  }

  // Acknowledge the webhook immediately so Svix doesn't retry while the agent runs.
  // All heavy processing (email fetch, agent execution, reply send) happens async.
  processEmail(email_id, webhookTo, parseResult.data.data).catch((err) =>
    logger.error({ err, email_id }, "Background email processing failed"),
  );

  return c.json({ accepted: true, email_id });
});

async function processEmail(
  email_id: string,
  _webhookTo: string[],
  webhookData: { from: string; to: string[]; subject: string; created_at: string },
) {
  logger.info({ email_id }, "Fetching full email content");

  // Webhook payload does not include body — must fetch separately via Resend REST API
  const emailRes = await fetch(`https://api.resend.com/emails/receiving/${email_id}`, {
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` },
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    logger.error({ status: emailRes.status, body: errText, email_id }, "Failed to fetch email content");
    return;
  }

  const fullEmail = await emailRes.json() as {
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    text?: string;
    html?: string;
    // headers may be an array [{name, value}] or a plain object {name: value}
    headers?: { name: string; value: string }[] | Record<string, string>;
  };

  logger.debug({ fullEmail }, "Full email content fetched");

  // All email metadata comes from the fetched payload, not the webhook
  const from = fullEmail.from ?? webhookData.from;
  const to = fullEmail.to ?? webhookData.to;
  const subject = fullEmail.subject ?? webhookData.subject;
  const receivedAt = fullEmail.created_at ?? webhookData.created_at;

  const { email: senderEmail } = extractEmailAddress(from);

  logger.info(
    {
      email_id,
      from,
      to,
      subject,
      hasText: !!fullEmail.text,
      hasHtml: !!fullEmail.html,
      headersType: Array.isArray(fullEmail.headers) ? "array" : typeof fullEmail.headers,
      headersCount: Array.isArray(fullEmail.headers)
        ? fullEmail.headers.length
        : fullEmail.headers
          ? Object.keys(fullEmail.headers).length
          : 0,
    },
    "Fetched email content",
  );

  const rawText = fullEmail.text ?? convert(fullEmail.html ?? "", { wordwrap: false });
  logger.debug({ rawText }, "Raw email text before stripping");
  const emailBody = stripQuotedReply(rawText);
  logger.debug({ emailBody }, "Email body after stripping quoted reply");

  // Normalize headers to a plain object regardless of API shape
  const headerMap: Record<string, string> = {};
  if (Array.isArray(fullEmail.headers)) {
    for (const h of fullEmail.headers) {
      headerMap[h.name.toLowerCase()] = h.value;
    }
  } else if (fullEmail.headers && typeof fullEmail.headers === "object") {
    for (const [k, v] of Object.entries(fullEmail.headers)) {
      headerMap[k.toLowerCase()] = v;
    }
  }

  const message_id = headerMap["message-id"] ?? email_id;
  const in_reply_to = headerMap["in-reply-to"] ?? null;

  logger.info({ email_id, senderEmail, subject, bodyLength: emailBody.length }, "Processing inbound email");

  // Pre-create a ModelGuide session. MCP tools require a valid, active session_id
  // in the DB before they will execute.
  let sessionId: string;
  try {
    sessionId = await createSession({ senderEmail, externalId: email_id });
  } catch (err) {
    logger.error({ err }, "Failed to pre-create ModelGuide session");
    return;
  }

  // Store the inbound email immediately — persisted even if the agent crashes
  await postUserMessage(sessionId, { from, to, subject, body: emailBody, receivedAt });

  // Run the agent
  const { output, steps } = await runWismoAgent({ sessionId, senderEmail, emailBody });
  const { replyBody, escalated: isEscalated, ticketId } = output;

  if (ticketId) {
    logger.info({ ticketId, sessionId, escalated: isEscalated }, "Zendesk ticket created");
  }

  logger.info(
    { senderEmail, sessionId, steps: steps.length, escalated: isEscalated, ticketId, reply: replyBody },
    "Agent completed",
  );

  // Send reply via Resend (threaded via In-Reply-To)
  const emailParams = {
    to: senderEmail,
    subject: `Re: ${subject}`,
    text: replyBody,
    inReplyTo: in_reply_to ?? message_id,
  };
  logger.info({ emailParams }, "Sending reply email");

  const { id: resendId } = await sendEmail(emailParams);

  logger.info({ resendId, sessionId }, "Reply sent");

  const status = isEscalated ? "abandoned" : "completed";

  // PATCH final status (fire-and-forget — reply is already sent)
  patchSessionStatus(sessionId, status).catch((err) =>
    logger.error({ err, sessionId }, "Background session status patch failed"),
  );
}
