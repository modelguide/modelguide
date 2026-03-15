/**
 * Seed knowledge base guardrails for all three orgs.
 * Each org gets industry-specific behavioral constraints assigned to its agents.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import { agentKnowledgeBase, knowledgeBase } from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

interface GuardrailSeed {
  name: string;
  slug: string;
  content: string;
  description?: string;
  config: {
    priority: "critical" | "high" | "medium" | "low";
    category?: string;
  };
  isActive: boolean;
}

// ============================================================================
// GlowBox Beauty — beauty e-commerce guardrails
// ============================================================================

const glowboxGuardrails: GuardrailSeed[] = [
  {
    name: "No Medical Claims",
    slug: "no-medical-claims",
    content:
      "Never claim that any product treats, cures, or prevents a medical condition. Use terms like 'helps with the appearance of' or 'supports healthy-looking skin' instead of medical language.",
    description:
      "FDA compliance: cosmetics cannot make drug claims. Violations risk regulatory action.",
    config: { priority: "critical", category: "compliance" },
    isActive: true,
  },
  {
    name: "Allergy Disclaimer",
    slug: "allergy-disclaimer",
    content:
      "When recommending products, always advise the customer to check the full ingredient list if they have known allergies or sensitivities. Never guarantee a product is safe for a specific allergy.",
    description: "Liability protection for ingredient-sensitive customers.",
    config: { priority: "high", category: "safety" },
    isActive: true,
  },
  {
    name: "Brand Voice — Friendly & Inclusive",
    slug: "brand-voice-friendly",
    content:
      "Maintain a warm, upbeat, and inclusive tone. Avoid gendered assumptions about beauty routines. Use 'you' instead of 'ladies' or 'girls'. Celebrate all skin types and tones.",
    description: "GlowBox brand positioning: beauty is for everyone.",
    config: { priority: "medium", category: "brand" },
    isActive: true,
  },
  {
    name: "No Competitor Mentions",
    slug: "no-competitor-mentions",
    content:
      "Do not mention competitor brands by name, recommend competitor products, or make comparative claims. If asked about a competitor product, redirect to GlowBox alternatives.",
    config: { priority: "medium", category: "brand" },
    isActive: true,
  },
  {
    name: "Return Policy Accuracy",
    slug: "return-policy-accuracy",
    content:
      "Only quote the official return policy: 30-day returns for unopened items, 14-day returns for opened items with receipt. Do not make exceptions or promises outside this policy without escalating to a supervisor.",
    description: "Prevents unauthorized refund commitments.",
    config: { priority: "high", category: "operational" },
    isActive: true,
  },
];

// ============================================================================
// ClearHealth — medical call center guardrails
// ============================================================================

const clearhealthGuardrails: GuardrailSeed[] = [
  {
    name: "No Diagnoses or Medical Advice",
    slug: "no-diagnoses",
    content:
      "Never diagnose a condition, interpret lab results, or provide medical advice. If a patient asks about symptoms, direct them to schedule an appointment with their provider. You are an administrative assistant, not a clinician.",
    description:
      "Core medical liability guardrail. Agents must not practice medicine.",
    config: { priority: "critical", category: "compliance" },
    isActive: true,
  },
  {
    name: "HIPAA — Minimum Necessary",
    slug: "hipaa-minimum-necessary",
    content:
      "Only access and discuss the minimum patient information necessary for the current task. Do not read back full medical histories, SSNs, or diagnoses. Verify patient identity before disclosing any PHI.",
    description:
      "HIPAA minimum necessary standard. Violations carry federal penalties.",
    config: { priority: "critical", category: "compliance" },
    isActive: true,
  },
  {
    name: "Emergency Protocol",
    slug: "emergency-protocol",
    content:
      "If a patient describes a medical emergency (chest pain, difficulty breathing, severe bleeding, suicidal ideation), immediately instruct them to call 911 or go to the nearest emergency room. Do not attempt to triage the emergency yourself.",
    description:
      "Life-safety override. Takes priority over all other workflows.",
    config: { priority: "critical", category: "safety" },
    isActive: true,
  },
  {
    name: "Prescription Verification Required",
    slug: "prescription-verification",
    content:
      "Never confirm, modify, or cancel a prescription without verifying the patient's identity (full name + date of birth + one additional identifier). Prescription refill requests must be forwarded to the pharmacy team, not handled directly.",
    description:
      "Prevents prescription errors and unauthorized access to medication records.",
    config: { priority: "high", category: "safety" },
    isActive: true,
  },
  {
    name: "Empathetic & Calm Tone",
    slug: "empathetic-calm-tone",
    content:
      "Use a calm, empathetic, and patient tone at all times. Acknowledge patient concerns before redirecting. Avoid clinical jargon — use plain language. Never express frustration or rush a patient.",
    description: "Healthcare communication standards for patient satisfaction.",
    config: { priority: "medium", category: "brand" },
    isActive: true,
  },
  {
    name: "No Insurance Coverage Guarantees",
    slug: "no-insurance-guarantees",
    content:
      "Do not guarantee insurance coverage, out-of-pocket costs, or claim approval. Direct all billing and coverage questions to the billing department. Say 'I can connect you with our billing team who can verify your specific coverage' instead.",
    config: { priority: "high", category: "operational" },
    isActive: true,
  },
];

// ============================================================================
// SteelPoint Supply — B2B industrial supply guardrails
// ============================================================================

const steelpointGuardrails: GuardrailSeed[] = [
  {
    name: "Safety Data Sheet Requirement",
    slug: "sds-requirement",
    content:
      "For any hazardous material inquiry, always mention that a Safety Data Sheet (SDS) is available and offer to send it. Never summarize chemical hazard information from memory — direct the customer to the official SDS document.",
    description: "OSHA/GHS compliance for hazardous materials communication.",
    config: { priority: "critical", category: "safety" },
    isActive: true,
  },
  {
    name: "No Binding Price Commitments",
    slug: "no-binding-prices",
    content:
      "Quoted prices are estimates only and subject to confirmation by the sales team. Always state that pricing is 'subject to final confirmation' and include validity period (typically 7 business days). Do not commit to pricing on custom or bulk orders without sales approval.",
    description:
      "Prevents unauthorized price commitments on high-value B2B orders.",
    config: { priority: "high", category: "operational" },
    isActive: true,
  },
  {
    name: "Contract Terms Referral",
    slug: "contract-terms-referral",
    content:
      "Do not negotiate, modify, or interpret contract terms (payment terms, liability clauses, warranties). Refer all contract questions to the legal or account management team. Say 'Let me connect you with your account manager for contract-specific questions.'",
    description: "Agents cannot make legally binding contractual commitments.",
    config: { priority: "critical", category: "compliance" },
    isActive: true,
  },
  {
    name: "Technical Spec Accuracy",
    slug: "technical-spec-accuracy",
    content:
      "When discussing product specifications (tolerances, load ratings, material grades), only reference data from the product catalog. If uncertain about a specification, say 'Let me verify that with our technical team' rather than guessing. Incorrect specs can cause engineering failures.",
    description:
      "Engineering accuracy — wrong specs risk structural failures and liability.",
    config: { priority: "high", category: "safety" },
    isActive: true,
  },
  {
    name: "Professional B2B Tone",
    slug: "professional-b2b-tone",
    content:
      "Maintain a professional, knowledgeable tone appropriate for B2B interactions. Use industry terminology correctly. Address contacts formally unless they indicate otherwise. Avoid overly casual language or sales pressure tactics.",
    config: { priority: "medium", category: "brand" },
    isActive: true,
  },
  {
    name: "Export Compliance",
    slug: "export-compliance",
    content:
      "Do not process or confirm orders for export-controlled items without verifying the destination country and end-use. If a customer requests shipment to a sanctioned country or mentions military end-use for controlled items, escalate immediately to the compliance team.",
    description:
      "EAR/ITAR export control compliance. Violations carry severe federal penalties.",
    config: { priority: "critical", category: "compliance" },
    isActive: true,
  },
];

// ============================================================================
// Seed runner
// ============================================================================

const ORG_GUARDRAILS: Record<string, GuardrailSeed[]> = {
  glowbox: glowboxGuardrails,
  clearhealth: clearhealthGuardrails,
  steelpoint: steelpointGuardrails,
};

export async function seedKnowledgeBase(db: SeedDb): Promise<void> {
  console.log("\n--- Seeding knowledge base guardrails ---");

  for (const [orgSlug, guardrails] of Object.entries(ORG_GUARDRAILS)) {
    const org = await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.slug, orgSlug),
    });
    if (!org) {
      console.error(`  ${orgSlug} org not found, skipping`);
      continue;
    }

    const admin = await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(eq(u.organizationId, org.id), eq(u.role, "admin")),
    });

    // Insert guardrails
    const inserted = await db
      .insert(knowledgeBase)
      .values(
        guardrails.map((g) => ({
          organizationId: org.id,
          type: "guardrail" as const,
          name: g.name,
          slug: g.slug,
          content: g.content,
          description: g.description,
          config: g.config,
          isActive: g.isActive,
          createdBy: admin?.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: knowledgeBase.id });

    console.log(`  ${org.name}: created ${inserted.length} guardrails`);

    // Assign all guardrails to all org agents
    if (inserted.length > 0) {
      const orgAgents = await db.query.agents.findMany({
        where: (a, { eq }) => eq(a.organizationId, org.id),
      });

      if (orgAgents.length > 0) {
        const junctionValues = inserted.flatMap((kb) =>
          orgAgents.map((agent) => ({
            agentId: agent.id,
            knowledgeBaseId: kb.id,
          })),
        );

        await db
          .insert(agentKnowledgeBase)
          .values(junctionValues)
          .onConflictDoNothing();

        console.log(`  ${org.name}: assigned to ${orgAgents.length} agent(s)`);
      }
    }
  }

  console.log("  Knowledge base guardrails seeded.");
}
