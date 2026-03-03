import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { MCPClient } from "@mastra/mcp";
import { z } from "zod";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { type Step, logAgentTurns, postStepMessages } from "../../lib/modelguide.client.js";

export interface UsageData {
  llm_model: string;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_total_tokens: number;
  cost_usd: number;
}

export const wismoRequestContextSchema = z.object({
  sessionId: z.string(),
  senderEmail: z.string().email(),
});

// Structured output schema
export const agentOutputSchema = z.object({
  ticketId: z.number().int().optional(),
  replyBody: z.string(),
  escalated: z.boolean().default(false),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

const FALLBACK_REPLY = "We received your message and will follow up shortly.";

const REPLY_START = "---REPLY_START---";
const REPLY_END = "---REPLY_END---";

/**
 * Extract the email reply from the agent's text using delimiters.
 * Falls back to the full text (stripped of delimiters) if markers are missing.
 */
function extractReply(text: string | undefined): string {
  if (!text) return FALLBACK_REPLY;

  const startIdx = text.indexOf(REPLY_START);
  const endIdx = text.indexOf(REPLY_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.slice(startIdx + REPLY_START.length, endIdx).trim();
  }

  // Delimiter missing — agent didn't follow format. Use full text as fallback.
  logger.warn("Agent output missing REPLY delimiters — using full text");
  return text.trim();
}

/**
 * Run the WISMO agent for a single email.
 * Manages the MCP client lifecycle, step collection, and output parsing.
 */
export async function runWismoAgent(params: {
  sessionId: string;
  senderEmail: string;
  emailBody: string;
}): Promise<{ output: AgentOutput; steps: Step[]; usage: UsageData }> {
  const { sessionId, senderEmail, emailBody } = params;

  const mcpClient = new MCPClient({
    servers: {
      modelguide: {
        url: new URL(config.MCP_SERVER_URL),
        requestInit: {
          headers: { Authorization: `Bearer ${config.MCP_API_KEY}` },
        },
        timeout: 30_000,
        connectTimeout: 15_000,
      },
    },
  });

  try {
    const toolsets = await mcpClient.listToolsets();
    logger.debug({ tools: Object.keys(toolsets) }, "MCP toolsets loaded");

    const requestContext = new RequestContext<z.infer<typeof wismoRequestContextSchema>>();
    requestContext.set("sessionId", sessionId);
    requestContext.set("senderEmail", senderEmail);

    let stepStartMs = Date.now();
    const stepLatenciesMs: number[] = [];
    const stepPostPromises: Promise<void>[] = [];

    const result = await wismoAgent.generate(emailBody, {
      toolsets,
      requestContext,
      maxSteps: 5,
      onStepFinish: (step) => {
        const now = Date.now();
        const latencyMs = now - stepStartMs;
        stepLatenciesMs.push(latencyMs);
        stepStartMs = now;
        const stepIndex = stepLatenciesMs.length - 1;
        logger.debug({ stepIndex, latencyMs }, "Step finished");
        stepPostPromises.push(
          postStepMessages(sessionId, step as Step, latencyMs).catch((err) =>
            logger.error({ err, stepIndex, sessionId }, "Failed to post step messages"),
          ),
        );
      },
    });

    await Promise.all(stepPostPromises);

    const steps = result.steps as Step[];
    logger.debug({ stepsCount: steps.length, stepLatenciesMs }, "Agent steps collected");

    // Derive structured output deterministically from steps — no LLM parsing needed.
    // replyBody = extracted from ---REPLY_START---/---REPLY_END--- delimiters in last step
    // escalated/ticketId = extracted from Zendesk tool call results, if any
    const lastTextStep = [...steps].reverse().find((s) => s.text && !s.toolCalls?.length);
    const replyBody = extractReply(lastTextStep?.text);

    let escalated = false;
    let ticketId: number | undefined;

    for (const step of steps) {
      for (const tr of step.toolResults ?? []) {
        if (tr.payload.toolName.includes("create_ticket")) {
          escalated = true;
          const res = tr.payload.result as Record<string, unknown> | undefined;
          const id = res?.ticketId ?? res?.ticket_id ?? res?.id;
          if (typeof id === "number") ticketId = id;
          else if (typeof id === "string" && /^\d+$/.test(id)) ticketId = Number(id);
        }
      }
    }

    const output: AgentOutput = { replyBody, escalated, ticketId };

    logger.debug({ output }, "Agent output derived from steps");

    logAgentTurns(steps, stepLatenciesMs);

    // Extract token usage and compute cost
    const inputTokens = result.totalUsage?.inputTokens ?? 0;
    const outputTokens = result.totalUsage?.outputTokens ?? 0;

    const cost =
      (inputTokens / 1_000_000) * config.AGENT_MODEL_INPUT_COST +
      (outputTokens / 1_000_000) * config.AGENT_MODEL_OUTPUT_COST;

    const usage: UsageData = {
      llm_model: config.AGENT_MODEL,
      llm_input_tokens: inputTokens,
      llm_output_tokens: outputTokens,
      llm_total_tokens: inputTokens + outputTokens,
      cost_usd: Number(cost.toFixed(6)),
    };

    logger.info({ usage }, "Token usage and cost computed");

    return { output, steps, usage };
  } finally {
    await mcpClient.disconnect();
  }
}

export const wismoAgent = new Agent({
  id: "wismo-agent",
  name: "wismo-agent",
  model: config.AGENT_MODEL,
  requestContextSchema: wismoRequestContextSchema,

  // Instructions are a function so session_id and sender email are injected
  // via RequestContext — keeps them out of the user prompt entirely.
  instructions: async ({ requestContext }) => {
    const sessionId = requestContext.get("sessionId");
    const senderEmail = requestContext.get("senderEmail");

    return `You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.

Session ID: ${sessionId}
Sender email: ${senderEmail}

You MUST pass the session_id "${sessionId}" to every tool call you make — the ModelGuide platform requires it for tracking.
Always use "${senderEmail}" as the requester / email argument when calling tools.

## Scope

You handle ONE type of request: order status / shipment tracking (WISMO — "Where Is My Order").

Out-of-scope requests include: returns, refunds, product complaints, damaged goods, account issues, billing disputes, general product questions, or anything else that is not order tracking. If the email is out of scope, escalate immediately — do NOT attempt to answer.

## Decision flow

First, decide: is this a WISMO request or out-of-scope?

**Out-of-scope** — the email is about returns, refunds, product complaints, damaged goods, account issues, billing disputes, or anything other than order tracking:
  1. Call the Zendesk ticket creation tool with:
     - subject: the original email subject
     - requesterEmail: ${senderEmail}
     - body: the original email body
     - tags: ["email", "escalated-by-bot"]
     - priority: "normal"
     - session_id: ${sessionId}
  2. Extract the ticket number from the result (an integer).
  3. Set escalated: true and include the ticket number in replyBody.
  4. Reply telling the customer their request has been logged as ticket #<number> and the support team will respond within 24 hours.

**WISMO** — the email is about order status or shipment tracking:
  - Extract the order number (e.g. "#1042", "order 1042"). Order numbers are integers.
  - No order number found → ask the customer to include their order number. Do not call any tool.
  - Order number found → call the order lookup tool with ${senderEmail}, the order number, and session_id ${sessionId}. Compose a reply based on the result (see below).
  - Do NOT create a Zendesk ticket for WISMO requests.

## Interpreting order lookup results

Always address the customer's specific question using the data returned by the tool. Do not give a generic status summary — answer what they actually asked (e.g. "where is my package?", "when will it arrive?", "has it shipped?").

- **found: false** → apologise and ask the customer to double-check their order number.
- **status: pending / processing** → tell the customer their order is still being prepared and has not shipped yet. Include the order number and any estimated date if present.
- **fulfillment_status: fulfilled / shipped** → confirm the order has shipped. Include: order number, carrier name, tracking number, tracking URL (if available), and estimated delivery date (if available). If tracking is available, encourage them to use it.
- **delay_detected: true** → acknowledge the delay directly and apologise. State what the current status is, what the next step is, and when they can expect an update.
- **Items in the order** → only mention specific items if the customer explicitly asked about them (e.g. "did my shampoo ship?"). Do not enumerate the full order contents unprompted.

## Tool errors

Do not expose technical details. Tell the customer there is a temporary issue and the support team will follow up within 24 hours.

## Output format

Your final message must contain the email reply text between \`---REPLY_START---\` and \`---REPLY_END---\` delimiters. You may include reasoning or analysis before the \`---REPLY_START---\` delimiter — this will be stored internally but never sent to the customer. Example:

---REPLY_START---
Dear Customer,

Your order #1042 has been shipped and is on its way.

Kind regards,
GlowBox Customer Care
---REPLY_END---

The text between the delimiters will be sent directly to the customer as-is. No markdown, no labels, no JSON — just plain email text.

## Tone

Professional and friendly. 3–5 sentences. Do not ask follow-up questions — this is a one-shot exchange. Never invent information you do not have.

For escalated requests, tell the customer their message has been passed to the support team and they will receive a response within 24 hours. Do not explain why you escalated.`;
  },
});
