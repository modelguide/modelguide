/**
 * Test email corpus — for eval comparison.
 *
 * Two cases: one in-scope (WISMO) and one out-of-scope (billing dispute).
 * `input` is a structured email; `toPrompt()` formats it for the agent.
 */

export interface EmailInput {
  from: string;
  subject: string;
  body: string;
}

export interface TestEmail {
  input: EmailInput;
  groundTruth: {
    expectedTool: string;
    shouldEscalate: boolean;
    replyMustInclude?: string[];
  };
  sessionId: string;
}

/** Format a structured email into the string the agent receives. */
export function toPrompt(email: EmailInput): string {
  return `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`;
}

export const testEmails: TestEmail[] = [
  // --- Case 1: Order Not Arrived (in-scope — SLA check) ---
  {
    input: {
      from: "jane@example.com",
      subject: "Order still not here",
      body: "Hi, it's been over a week and my order #1042 still hasn't shown up. Can you look into this?",
    },
    groundTruth: {
      expectedTool: "store_look_up_order",
      shouldEscalate: false,
      replyMustInclude: ["order", "working days"],
    },
    sessionId: "eval-001",
  },

  // --- Case 2: Billing / Payment Issue (out-of-scope — should escalate) ---
  {
    input: {
      from: "bob@example.com",
      subject: "Charged twice for my order",
      body: "I just checked my bank statement and it looks like I was charged twice for order #2048. Can you sort this out?",
    },
    groundTruth: {
      expectedTool: "helpdesk_create_ticket",
      shouldEscalate: true,
    },
    sessionId: "eval-002",
  },
];

/**
 * Deterministic tool responses for mocked MCP tools.
 * Both hand-built and compiled agents use the same mocks.
 */
export const mockedToolResponses: Record<string, Record<string, unknown>> = {
  store_look_up_order: {
    found: true,
    order_id: 1042,
    customer_email: "jane@example.com",
    order_date: "2026-02-20",
    status: "processing",
    fulfillment_status: "unfulfilled",
    items: [{ name: "Glow Serum", quantity: 1 }],
  },
  helpdesk_create_ticket: {
    ticketId: 8842,
    status: "open",
  },
};
