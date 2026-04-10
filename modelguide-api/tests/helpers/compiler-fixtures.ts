/**
 * Generic CompilerInput fixtures for integration and unit tests.
 *
 * These fixtures are intentionally domain-agnostic — realistic enough to
 * exercise all compiler paths but not tied to any specific customer or campaign.
 */

import type { CompilerInput } from "@features/compiler/core/types";

/**
 * A 4-step voice onboarding SOP with 3 guardrails.
 * Model family: gpt, modality: voice → exercises GptVoiceStrategy.
 */
export const gptVoiceOnboardingFixture: CompilerInput = {
  sops: [
    {
      id: "sop-onboarding",
      name: "Customer Onboarding",
      slug: "customer-onboarding",
      description:
        "Structured onboarding call for new customers. Covers account verification, product walkthrough, and next steps.",
      status: "active",
      version: "1.0",
      assignedAgents: [],
      sopTemplateId: null,
      template: null,
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "introduction",
            order: 1,
            instruction:
              "Greet the customer warmly and explain the purpose of the call. Set expectations for the 5-minute walkthrough.",
            required: true,
          },
          {
            id: "account-verification",
            order: 2,
            instruction:
              "Verify the customer's account details. Ask for their registered email and confirm their current plan.",
            required: true,
          },
          {
            id: "product-walkthrough",
            order: 3,
            instruction:
              "Walk through the key features relevant to their plan. Ask if they have tried the dashboard yet and offer to guide them through it.",
            required: true,
          },
          {
            id: "closing",
            order: 4,
            instruction:
              "Summarize the next steps. Confirm the customer knows how to reach support. End the call warmly.",
            required: true,
          },
        ],
        metadata: {
          escalationTriggers: [
            "customer becomes hostile or abusive",
            "customer requests legal action",
            "customer reports a billing dispute over $500",
          ],
        },
      },
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    },
  ],
  guardrails: [
    {
      id: "g-compensation",
      type: "guardrail",
      name: "Compensation — No Quotes",
      slug: "compensation-no-quotes",
      content:
        "Never quote specific compensation or pricing figures unless explicitly listed in the role context. Redirect all compensation discussions to the account manager.",
      description: "Redirect compensation questions to the account manager",
      config: { category: "compliance", priority: "critical" },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    },
    {
      id: "g-pii",
      type: "guardrail",
      name: "PII — Do Not Collect",
      slug: "pii-no-collect",
      content:
        "Never collect or store sensitive personally identifiable information such as SSN, date of birth, or financial account numbers during the call. If the customer volunteers such data, decline politely.",
      description: "No PII collection during the call",
      config: { category: "safety", priority: "critical" },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    },
    {
      id: "g-no-guarantees",
      type: "guardrail",
      name: "No Outcome Guarantees",
      slug: "no-outcome-guarantees",
      content:
        "Never promise or guarantee specific outcomes. Use measured, conditional language. Say 'this typically results in' rather than 'you will get'.",
      description: "Use conditional language — no outcome promises",
      config: { category: "compliance", priority: "high" },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    },
  ],
  agentConfig: {
    id: "agent-onboarding",
    name: "Onboarding Agent",
    model: "openai:gpt-4.1-mini",
    description:
      "Voice agent conducting structured customer onboarding calls. Guides customers through account verification and product setup.",
    promptConfig: {
      persona:
        'You are a professional customer success agent. You DRIVE the conversation — this is an outbound call where you guide the customer through a structured onboarding flow. You are proactive, not reactive.\n\nUse a warm, professional tone — friendly but efficient. NEVER SAY: "Great question!", "Absolutely!", "I\'d be happy to...". USE INSTEAD: "Sure" / "Got it" / "That makes sense".',
      fillerPhrases: ["One moment.", "Let me check on that.", "Just a second."],
      language: "The conversation is conducted in English.",
    },
    modelFamily: "gpt",
    modality: "voice",
  },
};
