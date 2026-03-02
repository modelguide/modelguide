/**
 * Unit tests for SOP Zod schemas.
 * Validates definition parsing, trigger discriminated union, step limits, and request schemas.
 */

import { describe, expect, test } from "bun:test";
import {
  createSopSchema,
  forkFromTemplateSchema,
  sopDefinitionSchema,
  sopStepSchema,
  updateSopSchema,
} from "@features/sops/sops.schemas";

// ============================================================================
// sopDefinitionSchema
// ============================================================================

describe("sopDefinitionSchema", () => {
  const validDefinition = {
    schemaVersion: 1,
    trigger: { type: "manual", config: {} },
    steps: [
      {
        id: "step-1",
        order: 1,
        instruction: "Do something",
        required: true,
      },
    ],
    metadata: {},
  };

  test("parses a valid definition", () => {
    const result = sopDefinitionSchema.safeParse(validDefinition);
    expect(result.success).toBe(true);
  });

  test("requires schemaVersion = 1", () => {
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      schemaVersion: 2,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing schemaVersion", () => {
    const { schemaVersion, ...rest } = validDefinition;
    const result = sopDefinitionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("allows empty steps array (for drafts)", () => {
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  test("rejects more than 100 steps", () => {
    const steps = Array.from({ length: 101 }, (_, i) => ({
      id: `step-${i}`,
      order: i + 1,
      instruction: "Do something",
      required: true,
    }));
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      steps,
    });
    expect(result.success).toBe(false);
  });

  test("parses definition with full metadata", () => {
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      metadata: {
        reasonCode: "WISMO-001",
        tags: ["order", "status"],
        estimatedDuration: "5 minutes",
        escalationTriggers: ["VIP customer"],
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects more than 20 tags", () => {
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      metadata: {
        tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
      },
    });
    expect(result.success).toBe(false);
  });

  test("rejects more than 10 escalation triggers", () => {
    const result = sopDefinitionSchema.safeParse({
      ...validDefinition,
      metadata: {
        escalationTriggers: Array.from(
          { length: 11 },
          (_, i) => `trigger-${i}`,
        ),
      },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Trigger discriminated union
// ============================================================================

describe("trigger types", () => {
  const base = {
    schemaVersion: 1,
    steps: [],
    metadata: {},
  };

  test("parses channel trigger", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "channel", config: { channelTypes: ["voice", "chat"] } },
    });
    expect(result.success).toBe(true);
  });

  test("rejects channel trigger with empty channelTypes", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "channel", config: { channelTypes: [] } },
    });
    expect(result.success).toBe(false);
  });

  test("rejects channel trigger with invalid channel type", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "channel", config: { channelTypes: ["phone"] } },
    });
    expect(result.success).toBe(false);
  });

  test("parses intent_detected trigger", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: {
        type: "intent_detected",
        config: { patterns: ["where is my order"] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects intent_detected with empty patterns", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "intent_detected", config: { patterns: [] } },
    });
    expect(result.success).toBe(false);
  });

  test("rejects intent_detected with pattern over 500 chars", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: {
        type: "intent_detected",
        config: { patterns: ["x".repeat(501)] },
      },
    });
    expect(result.success).toBe(false);
  });

  test("parses tool_present trigger", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: {
        type: "tool_present",
        config: { toolSlugs: ["get_order"], catalogSlug: "medusa" },
      },
    });
    expect(result.success).toBe(true);
  });

  test("parses manual trigger", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "manual", config: {} },
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown trigger type", () => {
    const result = sopDefinitionSchema.safeParse({
      ...base,
      trigger: { type: "auto", config: {} },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Step schema
// ============================================================================

describe("sopStepSchema", () => {
  test("parses a valid step without tool", () => {
    const result = sopStepSchema.safeParse({
      id: "greet",
      order: 1,
      instruction: "Greet the customer",
      required: true,
    });
    expect(result.success).toBe(true);
  });

  test("parses a step with tool reference", () => {
    const result = sopStepSchema.safeParse({
      id: "lookup",
      order: 2,
      instruction: "Look up the order",
      required: true,
      tool: {
        toolSlug: "get_order",
        connectorId: "550e8400-e29b-41d4-a716-446655440000",
        resolvedName: "glowbox_store_get_order",
      },
    });
    expect(result.success).toBe(true);
  });

  test("parses a step with template-style tool reference (catalogSlug)", () => {
    const result = sopStepSchema.safeParse({
      id: "lookup",
      order: 1,
      instruction: "Look up order",
      required: true,
      tool: { toolSlug: "get_order", catalogSlug: "medusa" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects step ID over 100 chars", () => {
    const result = sopStepSchema.safeParse({
      id: "x".repeat(101),
      order: 1,
      instruction: "Do something",
      required: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects instruction over 2000 chars", () => {
    const result = sopStepSchema.safeParse({
      id: "step",
      order: 1,
      instruction: "x".repeat(2001),
      required: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty instruction", () => {
    const result = sopStepSchema.safeParse({
      id: "step",
      order: 1,
      instruction: "",
      required: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects tool with empty toolSlug", () => {
    const result = sopStepSchema.safeParse({
      id: "step",
      order: 1,
      instruction: "Do something",
      required: true,
      tool: { toolSlug: "" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects tool with invalid connectorId (not UUID)", () => {
    const result = sopStepSchema.safeParse({
      id: "step",
      order: 1,
      instruction: "Do something",
      required: true,
      tool: { toolSlug: "get_order", connectorId: "not-a-uuid" },
    });
    expect(result.success).toBe(false);
  });

  test("allows optional notes", () => {
    const result = sopStepSchema.safeParse({
      id: "step",
      order: 1,
      instruction: "Do something",
      required: true,
      notes: "This step is important because...",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Request schemas
// ============================================================================

describe("createSopSchema", () => {
  test("parses valid create request", () => {
    const result = createSopSchema.safeParse({
      name: "Order Lookup",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [{ id: "s1", order: 1, instruction: "Greet", required: true }],
        metadata: {},
      },
    });
    expect(result.success).toBe(true);
  });

  test("auto-generates slug when omitted", () => {
    const result = createSopSchema.safeParse({
      name: "Order Lookup",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [],
        metadata: {},
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.slug).toBeUndefined(); // slug is optional, service generates it
  });

  test("rejects invalid slug format", () => {
    const result = createSopSchema.safeParse({
      name: "Test",
      slug: "Invalid Slug!",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [],
        metadata: {},
      },
    });
    expect(result.success).toBe(false);
  });

  test("allows agentIds", () => {
    const result = createSopSchema.safeParse({
      name: "Test",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [],
        metadata: {},
      },
      agentIds: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.success).toBe(true);
  });

  test("requires connectorId for SOP tool references", () => {
    const result = createSopSchema.safeParse({
      name: "Tool Step SOP",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "s1",
            order: 1,
            instruction: "Lookup order",
            required: true,
            tool: { toolSlug: "get_order" },
          },
        ],
        metadata: {},
      },
    });
    expect(result.success).toBe(false);
  });

  test("rejects template catalogSlug in SOP create definition", () => {
    const result = createSopSchema.safeParse({
      name: "Template Style Ref",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "s1",
            order: 1,
            instruction: "Lookup order",
            required: true,
            tool: { toolSlug: "get_order", catalogSlug: "medusa" },
          },
        ],
        metadata: {},
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("forkFromTemplateSchema", () => {
  test("parses valid fork request", () => {
    const result = forkFromTemplateSchema.safeParse({
      connectorMapping: {
        medusa: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(result.success).toBe(true);
  });

  test("allows optional name and slug override", () => {
    const result = forkFromTemplateSchema.safeParse({
      name: "Custom Order Lookup",
      slug: "custom-order-lookup",
      connectorMapping: {
        medusa: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(result.success).toBe(true);
  });

  test("allows trigger and metadata overrides", () => {
    const result = forkFromTemplateSchema.safeParse({
      connectorMapping: { medusa: "550e8400-e29b-41d4-a716-446655440000" },
      overrides: {
        trigger: { type: "manual", config: {} },
        metadata: { tags: ["custom"] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("strips step overrides (only trigger/metadata allowed)", () => {
    const result = forkFromTemplateSchema.safeParse({
      connectorMapping: { medusa: "550e8400-e29b-41d4-a716-446655440000" },
      overrides: {
        steps: [
          { id: "injected", order: 1, instruction: "Nope", required: true },
        ],
      },
    });
    // Should parse successfully but `steps` key is stripped
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overrides).toBeDefined();
      expect("steps" in (result.data.overrides ?? {})).toBe(false);
    }
  });
});

describe("updateSopSchema", () => {
  test("parses valid update with name only", () => {
    const result = updateSopSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  test("rejects empty update (no fields)", () => {
    const result = updateSopSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("parses update with definition", () => {
    const result = updateSopSchema.safeParse({
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          { id: "s1", order: 1, instruction: "Updated step", required: true },
        ],
        metadata: {},
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects update definition with catalogSlug tool reference", () => {
    const result = updateSopSchema.safeParse({
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "s1",
            order: 1,
            instruction: "Updated step",
            required: true,
            tool: { toolSlug: "get_order", catalogSlug: "medusa" },
          },
        ],
        metadata: {},
      },
    });
    expect(result.success).toBe(false);
  });
});
