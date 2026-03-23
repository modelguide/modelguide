/**
 * Seed SOP definitions for all three orgs.
 * Creates org-scoped SOPs with tool references pointing to existing connectors.
 *
 * GlowBox: Order Lookup (active), Return Process (draft), Product Recommendation (active),
 *          Damaged Item (active), Safety Escalation (active), Reorder (active)
 * ClearHealth: Prescription Refill (active), Billing Inquiry (active),
 *              Appointment Scheduling (active), Insurance Coverage (draft)
 * SteelPoint: Quote Request (active), Urgent Delivery Escalation (active),
 *             Wrong Spec Resolution (active), Recurring Order (draft)
 */

import type {
  SopMetadata,
  SopStep,
  SopTrigger,
} from "@features/sops/sops.types";
import { isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import { agentSops, evalConfigs, sopSteps, sops } from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

type EvalConfigSeed = {
  name: string;
  description?: string;
  evaluatorType:
    | "tool_called"
    | "tool_input_contains"
    | "no_tool_called"
    | "llm_judge";
  config: Record<string, unknown>;
};

async function ensureEvalConfig(
  db: SeedDb,
  orgId: string,
  createdBy: string | undefined,
  seed: EvalConfigSeed,
): Promise<string> {
  const existing = await db.query.evalConfigs.findFirst({
    where: (ec, { and, eq }) =>
      and(
        eq(ec.organizationId, orgId),
        eq(ec.name, seed.name),
        eq(ec.evaluatorType, seed.evaluatorType),
      ),
  });

  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(evalConfigs)
    .values({
      organizationId: orgId,
      name: seed.name,
      description: seed.description,
      evaluatorType: seed.evaluatorType,
      config: seed.config,
      createdBy,
    })
    .returning({ id: evalConfigs.id });

  return created.id;
}

// ============================================================================
// Helpers
// ============================================================================

/** Look up an org by slug, plus admin user. */
async function lookupOrg(db: SeedDb, orgSlug: string) {
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.slug, orgSlug),
  });
  if (!org) return null;

  const admin = await db.query.users.findFirst({
    where: (u, { eq, and }) =>
      and(eq(u.organizationId, org.id), eq(u.role, "admin")),
  });

  return { org, admin };
}

/** Look up a connector tool by connector slug + tool slug within an org. */
async function lookupTool(
  db: SeedDb,
  orgId: string,
  connectorSlug: string,
  toolSlug: string,
) {
  const connector = await db.query.connectors.findFirst({
    where: (c, { eq, and }) =>
      and(eq(c.organizationId, orgId), eq(c.slug, connectorSlug)),
  });
  if (!connector) return null;

  const tool = await db.query.connectorTools.findFirst({
    where: (ct, { eq, and }) =>
      and(
        eq(ct.connectorId, connector.id),
        eq(ct.slug, toolSlug),
        isNull(ct.deletedAt),
      ),
  });
  return tool ?? null;
}

/** Insert a SOP + steps + agent assignment in one go. */
async function insertSop(
  db: SeedDb,
  opts: {
    orgId: string;
    adminId?: string;
    templateSlug?: string;
    name: string;
    slug: string;
    description: string;
    trigger: SopTrigger;
    metadata: SopMetadata;
    status: "active" | "draft" | "archived";
    steps: Omit<SopStep, "order">[];
    agentIds?: string[];
  },
) {
  // Resolve template if provided
  let templateId: string | undefined;
  if (opts.templateSlug) {
    const tpl = await db.query.sopTemplates.findFirst({
      where: (t, { eq }) => eq(t.slug, opts.templateSlug!),
    });
    templateId = tpl?.id;
  }

  const [sop] = await db
    .insert(sops)
    .values({
      organizationId: opts.orgId,
      sopTemplateId: templateId,
      name: opts.name,
      slug: opts.slug,
      description: opts.description,
      trigger: opts.trigger,
      metadata: opts.metadata,
      status: opts.status,
      version: "1.0",
      createdBy: opts.adminId,
    })
    .onConflictDoNothing()
    .returning();

  if (!sop) {
    console.log(`  Skipped SOP: ${opts.name} (already exists)`);
    return null;
  }

  // Insert steps
  await db.insert(sopSteps).values(
    opts.steps.map((s, i) => ({
      sopId: sop.id,
      stepId: s.id,
      order: i + 1,
      instruction: s.instruction,
      required: s.required,
      connectorToolId: s.tool?.connectorToolId ?? null,
      evalConfigId: s.evalConfigId ?? null,
      notes: s.notes ?? null,
    })),
  );

  // Assign to agents
  if (opts.agentIds?.length) {
    for (const agentId of opts.agentIds) {
      await db
        .insert(agentSops)
        .values({ agentId, sopId: sop.id })
        .onConflictDoNothing();
    }
  }

  console.log(
    `  Created SOP: ${opts.name} (${opts.status}, ${opts.steps.length} steps)`,
  );
  return sop;
}

// ============================================================================
// GlowBox SOPs
// ============================================================================

async function seedGlowbox(db: SeedDb) {
  console.log("\n  GlowBox Beauty SOPs:");
  const lookup = await lookupOrg(db, "glowbox");
  if (!lookup) {
    console.error("    GlowBox org not found, skipping");
    return;
  }
  const { org, admin } = lookup;

  // Resolve tools
  const getOrder = await lookupTool(db, org.id, "glowbox_store", "get_order");
  const listProducts = await lookupTool(
    db,
    org.id,
    "glowbox_store",
    "list_products",
  );
  const getProduct = await lookupTool(
    db,
    org.id,
    "glowbox_store",
    "get_product",
  );
  const addToCart = await lookupTool(
    db,
    org.id,
    "glowbox_store",
    "add_to_cart",
  );
  const lookUpOrderHistory = await lookupTool(
    db,
    org.id,
    "glowbox_store",
    "look_up_order_history",
  );
  const createTicket = await lookupTool(
    db,
    org.id,
    "glowbox_support",
    "create_ticket",
  );

  if (!getOrder) {
    console.error("    glowbox_store.get_order not found, skipping");
    return;
  }

  // Look up agents (first two: Chat Assistant + Voice Concierge)
  const orgAgents = await db.query.agents.findMany({
    where: (a, { eq }) => eq(a.organizationId, org.id),
    limit: 2,
  });
  const agentIds = orgAgents.map((a) => a.id);

  // Shared eval configs
  const greetEvalId = await ensureEvalConfig(db, org.id, admin?.id, {
    name: "Seed: Greeting completed",
    description: "Agent greets customer and offers help.",
    evaluatorType: "llm_judge",
    config: {
      criterion:
        "The agent greets the customer and invites them to describe how they can help.",
    },
  });
  const verifyEvalId = await ensureEvalConfig(db, org.id, admin?.id, {
    name: "Seed: Identity verification requested",
    description: "Agent asks for an order identifier or email.",
    evaluatorType: "llm_judge",
    config: {
      criterion:
        "The agent asks the customer for an identifying detail (order number or email) before account-specific actions.",
    },
  });
  const lookupToolEvalId = await ensureEvalConfig(db, org.id, admin?.id, {
    name: "Seed: Lookup order tool called",
    description: "Verify get_order was called during order lookup.",
    evaluatorType: "tool_called",
    config: { connectorToolId: getOrder.id },
  });
  const communicateStatusEvalId = await ensureEvalConfig(
    db,
    org.id,
    admin?.id,
    {
      name: "Seed: Order status communicated",
      description: "Agent communicates order status clearly after lookup.",
      evaluatorType: "llm_judge",
      config: {
        criterion:
          "After lookup, the agent communicates the order status clearly to the customer.",
      },
    },
  );

  // ── 1. Order Lookup (active, forked from template) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "order-lookup",
    name: "Order Lookup",
    slug: "order-lookup",
    description:
      "Look up and communicate order status to customers. Forked from the Order Lookup template.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["where is my order", "order status", "track order"],
      },
    },
    metadata: {
      reasonCode: "WISMO-001",
      tags: ["order", "status", "tracking"],
      estimatedDuration: "2-5 minutes",
    },
    status: "active",
    steps: [
      {
        id: "greet",
        instruction: "Greet the customer and ask how you can help.",
        required: true,
        evalConfigId: greetEvalId,
      },
      {
        id: "verify-identity",
        instruction:
          "Ask for the customer's email address or order number to verify their identity.",
        required: true,
        evalConfigId: verifyEvalId,
      },
      {
        id: "lookup-order",
        instruction:
          "Look up the customer's order using the provided identifier.",
        required: true,
        evalConfigId: lookupToolEvalId,
        tool: { connectorToolId: getOrder.id },
      },
      {
        id: "communicate-status",
        instruction:
          "Communicate the order status clearly. Include expected delivery date if available.",
        required: true,
        evalConfigId: communicateStatusEvalId,
      },
      {
        id: "offer-help",
        instruction:
          "Ask if there's anything else you can help with before ending the interaction.",
        required: false,
      },
    ],
    agentIds,
  });

  // ── 2. Return Process (draft) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "return-item",
    name: "Return Process",
    slug: "return-process",
    description:
      "Standard procedure for processing customer returns. Verify purchase, check 30-day eligibility, generate RMA, process refund.",
    trigger: {
      type: "intent_detected",
      config: { patterns: ["return", "refund", "send back", "exchange"] },
    },
    metadata: {
      reasonCode: "RET-001",
      tags: ["return", "refund"],
      estimatedDuration: "5-10 minutes",
      escalationTriggers: [
        "Item damaged on arrival",
        "Return window exceeded but customer is a VIP",
      ],
    },
    status: "draft",
    steps: [
      {
        id: "greet",
        instruction: "Greet the customer and acknowledge their return request.",
        required: true,
        evalConfigId: greetEvalId,
      },
      {
        id: "verify-identity",
        instruction:
          "Verify the customer's identity by asking for their email or order number.",
        required: true,
        evalConfigId: verifyEvalId,
      },
      {
        id: "lookup-order",
        instruction: "Look up the original order to verify the purchase.",
        required: true,
        evalConfigId: lookupToolEvalId,
        tool: { connectorToolId: getOrder.id },
      },
      {
        id: "check-eligibility",
        instruction:
          "Check if the item is eligible for return (within 30-day window, unopened items 30 days / opened items 14 days with receipt).",
        required: true,
      },
      {
        id: "capture-reason",
        instruction:
          "Ask the customer why they want to return the product. Document the reason.",
        required: true,
      },
      {
        id: "process-return",
        instruction:
          "Generate a return number (RMA), send prepaid shipping label, and confirm refund timeline (3-5 business days after receipt).",
        required: true,
      },
      {
        id: "cross-sell",
        instruction:
          "Optionally suggest an alternative product that may better fit the customer's needs.",
        required: false,
      },
    ],
  });

  // ── 3. Product Recommendation (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "product-recommendation",
    name: "Product Recommendation",
    slug: "product-recommendation",
    description:
      "Guide customers through product discovery. Assess needs (skin type, budget), present curated options, add to cart.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["recommend", "suggest", "looking for", "what serum", "gift"],
      },
    },
    metadata: {
      reasonCode: "REC-001",
      tags: ["product", "recommendation", "purchase"],
      estimatedDuration: "3-8 minutes",
    },
    status: "active",
    steps: [
      {
        id: "needs-assessment",
        instruction:
          "Ask clarifying questions: skin type, budget, use case, or who the product is for (self vs. gift).",
        required: true,
      },
      {
        id: "search-products",
        instruction: "Search the catalog based on the customer's requirements.",
        required: true,
        tool: listProducts ? { connectorToolId: listProducts.id } : undefined,
      },
      {
        id: "present-options",
        instruction:
          "Present 2-3 curated options with brief descriptions, prices, and why each fits. Stay within the customer's budget.",
        required: true,
      },
      {
        id: "product-education",
        instruction:
          "If the customer asks follow-up questions, provide detailed product information (ingredients, benefits, how to use).",
        required: false,
        tool: getProduct ? { connectorToolId: getProduct.id } : undefined,
      },
      {
        id: "add-to-cart",
        instruction:
          "Add the chosen product to cart. Mention size options and any active promotions (free shipping thresholds).",
        required: false,
        tool: addToCart ? { connectorToolId: addToCart.id } : undefined,
      },
      {
        id: "closing",
        instruction: "Confirm total and ask if ready to checkout or continue.",
        required: false,
      },
    ],
    agentIds,
  });

  // ── 4. Damaged Item Resolution (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "damaged-item",
    name: "Damaged Item Resolution",
    slug: "damaged-item",
    description:
      "Handle reports of damaged items. Express-ship replacement without requiring return. Create quality ticket for logistics team.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["damaged", "broken", "cracked", "leaked", "defective"],
      },
    },
    metadata: {
      reasonCode: "DMG-001",
      tags: ["damaged", "quality", "replacement"],
      estimatedDuration: "5-8 minutes",
      escalationTriggers: [
        "Multiple damaged items in same order",
        "High-value item over $500",
      ],
    },
    status: "active",
    steps: [
      {
        id: "greet-empathize",
        instruction:
          "Apologize immediately for the damaged item. Express empathy.",
        required: true,
      },
      {
        id: "verify-order",
        instruction: "Ask for the order number and verify the purchase.",
        required: true,
        tool: { connectorToolId: getOrder.id },
      },
      {
        id: "document-damage",
        instruction:
          "Ask the customer to describe the damage. Note specifics for the report.",
        required: true,
      },
      {
        id: "ship-replacement",
        instruction:
          "Ship a free replacement via express (1-2 days). Do not require the customer to return the damaged item.",
        required: true,
      },
      {
        id: "create-quality-ticket",
        instruction:
          "Create a support ticket for the shipping/logistics team to investigate packaging.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
      {
        id: "closing",
        instruction:
          "Confirm next steps and timeline. Thank the customer for their patience.",
        required: false,
      },
    ],
    agentIds,
  });

  // ── 5. Safety Escalation (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "safety-escalation",
    name: "Safety Escalation",
    slug: "safety-escalation",
    description:
      "Handle allergic reactions and adverse product effects. Prioritize health, document, immediate refund without return, safety team follow-up.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["allergic", "reaction", "rash", "itchy", "burning"],
      },
    },
    metadata: {
      reasonCode: "SAFETY-001",
      tags: ["safety", "adverse-event", "escalation"],
      estimatedDuration: "5-10 minutes",
      escalationTriggers: [
        "Customer describes severe symptoms",
        "Multiple reports for same product",
      ],
    },
    status: "active",
    steps: [
      {
        id: "acknowledge-concern",
        instruction:
          "Express genuine concern for the customer's wellbeing. Prioritize health over transaction.",
        required: true,
      },
      {
        id: "assess-severity",
        instruction:
          "Ask what happened and determine severity. If emergency symptoms, instruct to call emergency services.",
        required: true,
      },
      {
        id: "lookup-order",
        instruction:
          "Look up the order to identify the specific product involved.",
        required: true,
        tool: { connectorToolId: getOrder.id },
      },
      {
        id: "safety-guidance",
        instruction:
          "Advise to stop using the product immediately. Suggest consulting a healthcare professional. Do not provide medical advice.",
        required: true,
      },
      {
        id: "create-safety-ticket",
        instruction:
          "Create a high-priority ticket for the safety team with full incident details.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
      {
        id: "refund-no-return",
        instruction:
          "Process an immediate full refund. Do not require return of a product that caused an adverse reaction.",
        required: true,
      },
      {
        id: "follow-up-promise",
        instruction:
          "Promise the safety team will follow up within 24 hours. Provide a reference number.",
        required: true,
      },
    ],
    agentIds,
  });

  // ── 6. Reorder Replenishment (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "reorder-replenishment",
    name: "Reorder Replenishment",
    slug: "reorder-replenishment",
    description:
      "Help returning customers reorder previous purchases. Look up history, check stock, offer alternatives if unavailable.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "reorder",
          "same as last time",
          "order again",
          "need more of",
        ],
      },
    },
    metadata: {
      reasonCode: "REORDER-001",
      tags: ["reorder", "replenishment", "repeat-purchase"],
      estimatedDuration: "3-7 minutes",
    },
    status: "active",
    steps: [
      {
        id: "greet",
        instruction: "Greet the customer and ask what they'd like to reorder.",
        required: true,
      },
      {
        id: "lookup-history",
        instruction:
          "Look up the customer's order history to find previous purchases.",
        required: true,
        tool: lookUpOrderHistory
          ? { connectorToolId: lookUpOrderHistory.id }
          : undefined,
      },
      {
        id: "confirm-items",
        instruction:
          "Confirm the items from the previous order the customer wants to reorder.",
        required: true,
      },
      {
        id: "check-stock",
        instruction:
          "Check availability. If out of stock, search for alternatives in the same product line.",
        required: true,
        tool: getProduct ? { connectorToolId: getProduct.id } : undefined,
      },
      {
        id: "add-to-cart",
        instruction: "Add confirmed items to cart. Show the total.",
        required: true,
        tool: addToCart ? { connectorToolId: addToCart.id } : undefined,
      },
      {
        id: "closing",
        instruction:
          "Respect the customer's closure signals. If they say 'that's it', confirm operational details (callbacks, notifications) and close warmly. Do NOT push checkout.",
        required: false,
        notes:
          "Critical: honor conversation closure cues. See BuildPro BAD/GOOD demo for anti-pattern.",
      },
    ],
    agentIds,
  });
}

// ============================================================================
// ClearHealth SOPs
// ============================================================================

async function seedClearhealth(db: SeedDb) {
  console.log("\n  ClearHealth SOPs:");
  const lookup = await lookupOrg(db, "clearhealth");
  if (!lookup) {
    console.error("    ClearHealth org not found, skipping");
    return;
  }
  const { org, admin } = lookup;

  // Resolve tools
  const getProduct = await lookupTool(
    db,
    org.id,
    "clearhealth_pharmacy",
    "get_product",
  );
  const createTicket = await lookupTool(
    db,
    org.id,
    "clearhealth_support",
    "create_ticket",
  );
  const searchTickets = await lookupTool(
    db,
    org.id,
    "clearhealth_support",
    "search_tickets",
  );

  // Look up agents
  const orgAgents = await db.query.agents.findMany({
    where: (a, { eq }) => eq(a.organizationId, org.id),
    limit: 2,
  });
  const agentIds = orgAgents.map((a) => a.id);

  // ── 1. Prescription Refill (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    name: "Prescription Refill",
    slug: "prescription-refill",
    description:
      "Process prescription refill requests. Verify patient identity (DOB + last name), check refill eligibility, confirm pickup location and timeline.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["refill", "prescription", "medication", "renew"],
      },
    },
    metadata: {
      reasonCode: "RX-001",
      tags: ["prescription", "refill", "pharmacy"],
      estimatedDuration: "3-5 minutes",
    },
    status: "active",
    steps: [
      {
        id: "verify-identity",
        instruction:
          "Verify patient identity: ask for date of birth and last name. Both must match before proceeding.",
        required: true,
      },
      {
        id: "lookup-prescription",
        instruction:
          "Look up the patient's prescription. Confirm medication name, dosage, and remaining refills.",
        required: true,
        tool: getProduct ? { connectorToolId: getProduct.id } : undefined,
      },
      {
        id: "confirm-quantity",
        instruction:
          "Present quantity options (e.g. 30-count vs 90-count) and confirm the patient's choice.",
        required: true,
      },
      {
        id: "confirm-pickup",
        instruction:
          "Confirm pickup location and estimated ready time. Promise a text notification when ready.",
        required: true,
      },
      {
        id: "closing",
        instruction:
          "Ask if anything else is needed. Remind the patient of remaining refills.",
        required: false,
      },
    ],
    agentIds,
  });

  // ── 2. Billing Inquiry (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "billing-dispute",
    name: "Billing Inquiry",
    slug: "billing-inquiry",
    description:
      "Handle billing disputes and unrecognized charges. Verify identity, investigate charge, explain or escalate to billing team.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["bill", "charge", "payment", "invoice", "overcharged"],
      },
    },
    metadata: {
      reasonCode: "BILL-001",
      tags: ["billing", "dispute", "charge"],
      estimatedDuration: "5-10 minutes",
      escalationTriggers: [
        "Disputed amount over $500",
        "Repeated billing errors on same account",
      ],
    },
    status: "active",
    steps: [
      {
        id: "verify-identity",
        instruction:
          "Verify patient identity (DOB + last name) before accessing billing records.",
        required: true,
      },
      {
        id: "understand-dispute",
        instruction:
          "Ask the patient to describe the charge: amount, date, and what they expected.",
        required: true,
      },
      {
        id: "search-existing",
        instruction:
          "Search for any existing tickets related to this billing issue.",
        required: true,
        tool: searchTickets ? { connectorToolId: searchTickets.id } : undefined,
      },
      {
        id: "investigate-charge",
        instruction:
          "Investigate the charge. Explain clearly if legitimate (e.g. lab work billed separately from office visit, insurance coverage gaps).",
        required: true,
      },
      {
        id: "escalate-if-needed",
        instruction:
          "If unresolved, create a ticket for the billing team with all details. Promise callback within 24 hours from billing specialist.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
      {
        id: "closing",
        instruction:
          "Provide the ticket number and expected resolution timeline.",
        required: true,
      },
    ],
    agentIds,
  });

  // ── 3. Appointment Scheduling (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "appointment-scheduling",
    name: "Appointment Scheduling",
    slug: "appointment-scheduling",
    description:
      "Schedule, reschedule, or confirm appointments. Present available slots, confirm booking, provide pre-visit instructions.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["appointment", "schedule", "book", "see the doctor"],
      },
    },
    metadata: {
      reasonCode: "APPT-001",
      tags: ["appointment", "scheduling"],
      estimatedDuration: "3-5 minutes",
    },
    status: "active",
    steps: [
      {
        id: "verify-identity",
        instruction: "Verify patient identity (name + DOB or account number).",
        required: true,
      },
      {
        id: "determine-type",
        instruction:
          "Ask if this is a new appointment, reschedule, or cancellation. Clarify appointment type (routine, follow-up, specific concern).",
        required: true,
      },
      {
        id: "present-availability",
        instruction:
          "Present 2-3 available time slots with date, time, and provider name.",
        required: true,
      },
      {
        id: "confirm-booking",
        instruction:
          "Confirm the selected slot with full details: date, time, provider, location.",
        required: true,
      },
      {
        id: "pre-visit-instructions",
        instruction:
          "Provide pre-visit instructions: arrive 15 minutes early, bring insurance card, any fasting requirements.",
        required: false,
      },
      {
        id: "create-confirmation",
        instruction:
          "Create a confirmation record. Promise a confirmation text and a reminder the day before.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
    ],
    agentIds,
  });

  // ── 4. Insurance Coverage Inquiry (draft) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    name: "Insurance Coverage Inquiry",
    slug: "insurance-coverage",
    description:
      "Answer insurance coverage questions. Provide general plan guidance but never guarantee coverage. Submit verification requests to billing team.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["insurance", "coverage", "covered", "copay", "deductible"],
      },
    },
    metadata: {
      reasonCode: "INS-001",
      tags: ["insurance", "coverage", "billing"],
      estimatedDuration: "3-7 minutes",
    },
    status: "draft",
    steps: [
      {
        id: "verify-identity",
        instruction: "Verify patient identity before discussing plan details.",
        required: true,
      },
      {
        id: "understand-question",
        instruction:
          "Ask which product/service and insurance plan (e.g. Blue Cross PPO). Identify the specific coverage question.",
        required: true,
      },
      {
        id: "lookup-product",
        instruction:
          "Look up the product or service to provide pricing information.",
        required: true,
        tool: getProduct ? { connectorToolId: getProduct.id } : undefined,
      },
      {
        id: "provide-estimate",
        instruction:
          "Provide a general cost estimate based on typical plan coverage. Clearly state this is an estimate, not a guarantee.",
        required: true,
        notes:
          "NEVER guarantee insurance coverage or out-of-pocket costs. Use language like 'typically covers' and 'estimated'.",
      },
      {
        id: "submit-verification",
        instruction:
          "Offer to submit a coverage verification request. Promise response within 1 business day via email.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
    ],
  });
}

// ============================================================================
// SteelPoint SOPs
// ============================================================================

async function seedSteelpoint(db: SeedDb) {
  console.log("\n  SteelPoint Supply SOPs:");
  const lookup = await lookupOrg(db, "steelpoint");
  if (!lookup) {
    console.error("    SteelPoint org not found, skipping");
    return;
  }
  const { org, admin } = lookup;

  // Resolve tools
  const listProducts = await lookupTool(
    db,
    org.id,
    "steelpoint_catalog",
    "list_products",
  );
  const getOrder = await lookupTool(
    db,
    org.id,
    "steelpoint_catalog",
    "get_order",
  );
  const addToCart = await lookupTool(
    db,
    org.id,
    "steelpoint_catalog",
    "add_to_cart",
  );
  const createTicket = await lookupTool(
    db,
    org.id,
    "steelpoint_support",
    "create_ticket",
  );
  // Look up agents
  const orgAgents = await db.query.agents.findMany({
    where: (a, { eq }) => eq(a.organizationId, org.id),
    limit: 2,
  });
  const agentIds = orgAgents.map((a) => a.id);

  // ── 1. Quote Request (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    templateSlug: "quote-request",
    name: "Quote Request",
    slug: "quote-request",
    description:
      "Process B2B quote requests. Gather specs, calculate volume-discounted pricing, generate formal quote with validity period.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: ["quote", "pricing", "bulk", "how much for"],
      },
    },
    metadata: {
      reasonCode: "QUOTE-001",
      tags: ["quote", "pricing", "b2b"],
      estimatedDuration: "5-10 minutes",
      escalationTriggers: [
        "Custom pricing beyond standard tiers",
        "Order value exceeding €50,000",
      ],
    },
    status: "active",
    steps: [
      {
        id: "gather-requirements",
        instruction:
          "Ask for product specifications (material grade, dimensions), quantity, delivery requirements, and certifications needed (e.g. material certificates 3.1).",
        required: true,
      },
      {
        id: "lookup-products",
        instruction:
          "Look up requested products to verify availability and current pricing.",
        required: true,
        tool: listProducts ? { connectorToolId: listProducts.id } : undefined,
      },
      {
        id: "calculate-pricing",
        instruction:
          "Calculate total including volume discount. State pricing is 'subject to final confirmation' with validity period (14 business days).",
        required: true,
        notes:
          "Never make binding price commitments. All quotes subject to sales team confirmation.",
      },
      {
        id: "present-quote",
        instruction:
          "Present line items: unit cost, quantity, discount %, total, delivery timeline, and inclusions (certificates, shipping).",
        required: true,
      },
      {
        id: "formalize-quote",
        instruction:
          "Generate a quote reference number (QT-XXXXX). Send formal quote to the customer's procurement email.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
    ],
    agentIds,
  });

  // ── 2. Urgent Delivery Escalation (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    name: "Urgent Delivery Escalation",
    slug: "urgent-delivery-escalation",
    description:
      "Handle production-critical delivery delays. Investigate logistics, provide contingency options (emergency warehouse dispatch), schedule callback.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "delayed",
          "not arrived",
          "production stopped",
          "urgent delivery",
        ],
      },
    },
    metadata: {
      reasonCode: "URG-001",
      tags: ["urgent", "delivery", "escalation", "production-critical"],
      estimatedDuration: "5-10 minutes",
      escalationTriggers: [
        "Production line stopped",
        "Delivery more than 24 hours late",
      ],
    },
    status: "active",
    steps: [
      {
        id: "acknowledge-urgency",
        instruction:
          "Acknowledge the urgency immediately. Treat production-critical delays as highest priority.",
        required: true,
      },
      {
        id: "lookup-order",
        instruction:
          "Look up the order to check current shipment status and logistics details.",
        required: true,
        tool: getOrder ? { connectorToolId: getOrder.id } : undefined,
      },
      {
        id: "investigate-logistics",
        instruction:
          "Investigate the delay (courier status, sorting hub, dispatch issues). Provide a current ETA.",
        required: true,
      },
      {
        id: "create-urgent-ticket",
        instruction:
          "Create an urgent support ticket flagged as production-critical for the logistics team.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
      {
        id: "contingency-plan",
        instruction:
          "If ETA is uncertain, offer contingency: emergency warehouse dispatch from nearest location with same-day delivery if stock available.",
        required: true,
      },
      {
        id: "schedule-callback",
        instruction:
          "Schedule a callback at a specific time with an update. Capture the best contact number.",
        required: true,
      },
    ],
    agentIds,
  });

  // ── 3. Wrong Specification Resolution (active) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    name: "Wrong Specification Resolution",
    slug: "wrong-spec-resolution",
    description:
      "Handle cases where wrong product specifications were shipped. Express-ship correct items, arrange free pickup of incorrect items, apply compensation.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "wrong spec",
          "wrong size",
          "incorrect",
          "not what I ordered",
          "specification mismatch",
        ],
      },
    },
    metadata: {
      reasonCode: "SPEC-001",
      tags: ["wrong-spec", "resolution", "replacement"],
      estimatedDuration: "5-8 minutes",
      escalationTriggers: [
        "Customer has imminent project deadline",
        "High-value order exceeding €10,000",
      ],
    },
    status: "active",
    steps: [
      {
        id: "verify-order",
        instruction:
          "Look up the order and verify the specification mismatch (ordered vs. received).",
        required: true,
        tool: getOrder ? { connectorToolId: getOrder.id } : undefined,
      },
      {
        id: "acknowledge-error",
        instruction:
          "Acknowledge the error clearly. Apologize and confirm the root cause.",
        required: true,
      },
      {
        id: "resolution-plan",
        instruction:
          "Present the resolution: express-ship correct items (delivery timeline), free pickup of incorrect items (no return burden), and compensation (e.g. 5% discount on next order).",
        required: true,
      },
      {
        id: "confirm-timeline",
        instruction:
          "Confirm the replacement delivery meets the customer's project deadline.",
        required: true,
      },
      {
        id: "create-tracking-ticket",
        instruction:
          "Create an urgent ticket with full details. Promise tracking number via email within 1 hour and personal follow-up next morning.",
        required: true,
        tool: createTicket ? { connectorToolId: createTicket.id } : undefined,
      },
    ],
    agentIds,
  });

  // ── 4. Recurring Order Setup (draft) ──
  await insertSop(db, {
    orgId: org.id,
    adminId: admin?.id,
    name: "Recurring Order Setup",
    slug: "recurring-order",
    description:
      "Set up bi-weekly or monthly recurring orders for B2B customers. Calculate volume discounts, confirm schedule, and activate auto-delivery.",
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "recurring",
          "regular order",
          "scheduled delivery",
          "auto-order",
          "every two weeks",
        ],
      },
    },
    metadata: {
      reasonCode: "RECUR-001",
      tags: ["recurring", "b2b", "auto-delivery"],
      estimatedDuration: "5-8 minutes",
    },
    status: "draft",
    steps: [
      {
        id: "gather-requirements",
        instruction:
          "Ask for products, quantities, and delivery frequency (weekly, bi-weekly, monthly).",
        required: true,
      },
      {
        id: "lookup-products",
        instruction: "Look up requested products for pricing and availability.",
        required: true,
        tool: listProducts ? { connectorToolId: listProducts.id } : undefined,
      },
      {
        id: "calculate-pricing",
        instruction:
          "Calculate per-delivery cost with recurring volume discount (e.g. 8%). Include free shipping if applicable.",
        required: true,
      },
      {
        id: "confirm-schedule",
        instruction:
          "Confirm first delivery date, frequency, and billing method (account billing vs. per-delivery).",
        required: true,
      },
      {
        id: "activate-order",
        instruction:
          "Generate a recurring order reference (RO-XXXXX). Confirm the discount applies to all future deliveries. Send confirmation email.",
        required: true,
        tool: addToCart ? { connectorToolId: addToCart.id } : undefined,
      },
    ],
  });
}

// ============================================================================
// Main
// ============================================================================

export async function seedSopDefinitions(db: SeedDb): Promise<void> {
  console.log("\n--- Seeding SOP definitions for all orgs ---");
  await seedGlowbox(db);
  await seedClearhealth(db);
  await seedSteelpoint(db);
  console.log("\n  SOP definitions seeded.");
}
