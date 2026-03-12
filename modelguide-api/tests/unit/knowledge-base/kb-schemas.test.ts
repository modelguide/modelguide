import { describe, expect, test } from "bun:test";
import {
  createKnowledgeBaseSchema,
  guardrailConfigSchema,
  knowledgeBaseListQuerySchema,
  updateKnowledgeBaseSchema,
} from "@features/knowledge-base/knowledge-base.schemas";

// ============================================================================
// Guardrail config schema
// ============================================================================

describe("guardrailConfigSchema", () => {
  test("parses valid config with all fields", () => {
    const result = guardrailConfigSchema.safeParse({
      category: "safety",
      priority: "critical",
    });
    expect(result.success).toBe(true);
  });

  test("parses config without optional category", () => {
    const result = guardrailConfigSchema.safeParse({ priority: "low" });
    expect(result.success).toBe(true);
  });

  test("rejects invalid priority", () => {
    const result = guardrailConfigSchema.safeParse({
      priority: "urgent",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid category", () => {
    const result = guardrailConfigSchema.safeParse({
      category: "unknown",
      priority: "high",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing priority", () => {
    const result = guardrailConfigSchema.safeParse({
      category: "brand",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Create schema
// ============================================================================

describe("createKnowledgeBaseSchema", () => {
  const validPayload = {
    type: "guardrail",
    name: "No surname usage",
    content: "Never use the customer's surname in conversation",
    config: { priority: "high" },
  };

  test("parses valid create payload", () => {
    const result = createKnowledgeBaseSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  test("parses payload with all optional fields", () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...validPayload,
      slug: "no-surname",
      description: "Protects customer privacy",
      isActive: false,
      agentIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(result.success).toBe(true);
  });

  test("requires type field", () => {
    const { type: _, ...noType } = validPayload;
    const result = createKnowledgeBaseSchema.safeParse(noType);
    expect(result.success).toBe(false);
  });

  test("requires name field", () => {
    const { name: _, ...noName } = validPayload;
    const result = createKnowledgeBaseSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  test("requires content field", () => {
    const { content: _, ...noContent } = validPayload;
    const result = createKnowledgeBaseSchema.safeParse(noContent);
    expect(result.success).toBe(false);
  });

  test("requires config field", () => {
    const { config: _, ...noConfig } = validPayload;
    const result = createKnowledgeBaseSchema.safeParse(noConfig);
    expect(result.success).toBe(false);
  });

  test("rejects unknown type", () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...validPayload,
      type: "faq",
    });
    expect(result.success).toBe(false);
  });

  test("validates slug format", () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...validPayload,
      slug: "Invalid Slug!",
    });
    expect(result.success).toBe(false);
  });

  test("validates agentIds are UUIDs", () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...validPayload,
      agentIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects content over 5000 chars", () => {
    const result = createKnowledgeBaseSchema.safeParse({
      ...validPayload,
      content: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Update schema
// ============================================================================

describe("updateKnowledgeBaseSchema", () => {
  test("accepts partial update with name only", () => {
    const result = updateKnowledgeBaseSchema.safeParse({
      name: "Updated name",
    });
    expect(result.success).toBe(true);
  });

  test("accepts partial update with content only", () => {
    const result = updateKnowledgeBaseSchema.safeParse({
      content: "Updated content",
    });
    expect(result.success).toBe(true);
  });

  test("accepts partial update with isActive only", () => {
    const result = updateKnowledgeBaseSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  test("accepts partial update with agentIds only", () => {
    const result = updateKnowledgeBaseSchema.safeParse({
      agentIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts null description (clear)", () => {
    const result = updateKnowledgeBaseSchema.safeParse({
      description: null,
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty object", () => {
    const result = updateKnowledgeBaseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// List query schema
// ============================================================================

describe("knowledgeBaseListQuerySchema", () => {
  test("parses with defaults", () => {
    const result = knowledgeBaseListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  test("parses with all filters", () => {
    const result = knowledgeBaseListQuerySchema.safeParse({
      type: "guardrail",
      isActive: "true",
      agentId: "00000000-0000-0000-0000-000000000001",
      category: "safety",
      page: "2",
      pageSize: "10",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
      expect(result.data.page).toBe(2);
    }
  });

  test("rejects invalid type filter", () => {
    const result = knowledgeBaseListQuerySchema.safeParse({ type: "faq" });
    expect(result.success).toBe(false);
  });
});
