import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { MCPClient } from "@mastra/mcp";
import { z } from "zod";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { type Step, logAgentTurns, postStepMessages } from "../../lib/modelguide.js";

export const wismoRequestContextSchema = z.object({
  sessionId: z.string(),
  senderEmail: z.string().email(),
});

// Structured output schema — agent's final JSON-only message
export const agentOutputSchema = z.object({
  ticketId: z.number().int().optional(),
  replyBody: z.string(),
  escalated: z.boolean().default(false),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

/** Extract the last complete {...} block from agent text output */
function tryParseJson(text: string): unknown {
  let lastMatch: string | null = null;
  const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastMatch = m[0];
  }
  if (!lastMatch) return null;
  try {
    return JSON.parse(lastMatch);
  } catch {
    return null;
  }
}

/**
 * Run the WISMO agent for a single email.
 * Manages the MCP client lifecycle, step collection, and output parsing.
 */
export async function runWismoAgent(params: {
  sessionId: string;
  senderEmail: string;
  emailBody: string;
}): Promise<{ output: AgentOutput; steps: Step[] }> {
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

    const lastStepText = [...steps].reverse().find((s) => s.text)?.text ?? "";
    const parsed = agentOutputSchema.safeParse(tryParseJson(lastStepText));

    let output: AgentOutput;
    if (parsed.success) {
      output = parsed.data;
    } else {
      logger.warn(
        { lastStepText, parseError: parsed.error.flatten() },
        "Agent output JSON parse failed — using fallback reply",
      );
      output = { replyBody: "We received your message and will follow up shortly.", escalated: false };
    }

    logAgentTurns(steps, stepLatenciesMs);
    return { output, steps };
  } finally {
    await mcpClient.disconnect();
  }
}

export const wismoAgent = new Agent({
  id: "wismo-agent",
  name: "wismo-agent",
  model: "anthropic/claude-sonnet-4-6",
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

Your FINAL message must be ONLY the raw JSON object — nothing before it, nothing after it, no markdown, no code fences, no explanation. Any reasoning must happen in prior steps before the final JSON-only message.

## Tone

Professional and friendly. 3–5 sentences. Do not ask follow-up questions — this is a one-shot exchange. Never invent information you do not have.

For escalated requests, tell the customer their message has been passed to the support team and they will receive a response within 24 hours. Do not explain why you escalated.`;
  },
});
