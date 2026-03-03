/**
 * Seed SOP definitions for the demo org (GlowBox).
 * Creates org-scoped SOPs with tool references pointing to existing connectors.
 */

import type { SopStep } from "@features/sops/sops.types";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import { agentSops, sopSteps, sops } from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

export async function seedSopDefinitions(db: SeedDb): Promise<void> {
  console.log("\n--- Seeding SOP definitions for demo org ---");

  // Look up demo org
  const org = await db.query.organizations.findFirst({
    where: (o, { eq }) => eq(o.slug, "glowbox"),
  });
  if (!org) {
    console.error("  GlowBox org not found, skipping SOP defs");
    return;
  }

  // Look up admin user (for createdBy)
  const admin = await db.query.users.findFirst({
    where: (u, { eq, and }) =>
      and(
        eq(u.organizationId, org.id),
        eq(u.email, "delivered+admin-glowbox@resend.dev"),
      ),
  });

  // Look up the Medusa connector for glowbox
  const medusaConnector = await db.query.connectors.findFirst({
    where: (c, { eq, and }) =>
      and(eq(c.organizationId, org.id), eq(c.slug, "glowbox_store")),
  });

  if (!medusaConnector) {
    console.error("  GlowBox Medusa connector not found, skipping SOP defs");
    return;
  }

  // Look up the get_order connector tool
  const getOrderTool = await db.query.connectorTools.findFirst({
    where: (ct, { eq, and, isNull }) =>
      and(
        eq(ct.connectorId, medusaConnector.id),
        eq(ct.slug, "get_order"),
        isNull(ct.deletedAt),
      ),
  });

  if (!getOrderTool) {
    console.error("  get_order tool not found, skipping SOP defs");
    return;
  }

  // Look up the order-lookup template
  const orderLookupTemplate = await db.query.sopTemplates.findFirst({
    where: (t, { eq }) => eq(t.slug, "order-lookup"),
  });

  // Look up first agent
  const agent = await db.query.agents.findFirst({
    where: (a, { eq }) => eq(a.organizationId, org.id),
  });

  // Create an "Order Lookup" SOP (forked from template)
  // Note: `order` is omitted — normalizeStepOrder() computes it from array position.
  const orderLookupSteps: Omit<SopStep, "order">[] = [
    {
      id: "greet",
      instruction: "Greet the customer and ask how you can help.",
      required: true,
    },
    {
      id: "verify-identity",
      instruction:
        "Ask for the customer's email address or order number to verify their identity.",
      required: true,
    },
    {
      id: "lookup-order",
      instruction:
        "Look up the customer's order using the provided identifier.",
      required: true,
      tool: {
        connectorToolId: getOrderTool.id,
      },
    },
    {
      id: "communicate-status",
      instruction:
        "Communicate the order status clearly. Include expected delivery date if available.",
      required: true,
    },
    {
      id: "offer-help",
      instruction:
        "Ask if there's anything else you can help with before ending the interaction.",
      required: false,
    },
  ];

  const [orderSop] = await db
    .insert(sops)
    .values({
      organizationId: org.id,
      sopTemplateId: orderLookupTemplate?.id,
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
      version: "1.0",
      createdBy: admin?.id,
    })
    .onConflictDoNothing()
    .returning();

  if (orderSop) {
    // Insert steps into sop_steps table (order from array position)
    await db.insert(sopSteps).values(
      orderLookupSteps.map((s, i) => ({
        sopId: orderSop.id,
        stepId: s.id,
        order: i + 1,
        instruction: s.instruction,
        required: s.required,
        connectorToolId: s.tool?.connectorToolId ?? null,
        notes: s.notes ?? null,
      })),
    );
    console.log("  Created SOP: Order Lookup (active)");

    // Assign to agent if available
    if (agent) {
      await db
        .insert(agentSops)
        .values({ agentId: agent.id, sopId: orderSop.id })
        .onConflictDoNothing();
      console.log(`  Assigned to agent: ${agent.name}`);
    }
  }

  // Create a "Return Process" SOP (from scratch, draft)
  const returnSteps: Omit<SopStep, "order">[] = [
    {
      id: "greet",
      instruction: "Greet the customer and acknowledge their return request.",
      required: true,
    },
    {
      id: "verify-identity",
      instruction:
        "Verify the customer's identity by asking for their email or order number.",
      required: true,
    },
    {
      id: "lookup-order",
      instruction: "Look up the original order to verify the purchase.",
      required: true,
      tool: {
        connectorToolId: getOrderTool.id,
      },
    },
  ];

  const [returnSop] = await db
    .insert(sops)
    .values({
      organizationId: org.id,
      name: "Return Process",
      slug: "return-process",
      description:
        "Standard procedure for processing customer returns. Currently in draft.",
      trigger: {
        type: "intent_detected",
        config: { patterns: ["return", "refund", "send back"] },
      },
      metadata: {
        reasonCode: "RET-001",
        tags: ["return", "refund"],
        estimatedDuration: "5-10 minutes",
      },
      status: "draft",
      version: "1.0",
      createdBy: admin?.id,
    })
    .onConflictDoNothing()
    .returning();

  if (returnSop) {
    // Insert steps into sop_steps table (order from array position)
    await db.insert(sopSteps).values(
      returnSteps.map((s, i) => ({
        sopId: returnSop.id,
        stepId: s.id,
        order: i + 1,
        instruction: s.instruction,
        required: s.required,
        connectorToolId: s.tool?.connectorToolId ?? null,
        notes: s.notes ?? null,
      })),
    );
    console.log("  Created SOP: Return Process (draft)");
  }

  console.log("  SOP definitions seeded.");
}
