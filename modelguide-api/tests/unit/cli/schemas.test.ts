import { describe, expect, test } from "bun:test";
import { agentItemSchema } from "../../../src/cli/schemas/agents.schema";
import { connectorItemSchema } from "../../../src/cli/schemas/connectors.schema";
import { guardrailItemSchema } from "../../../src/cli/schemas/guardrails.schema";
import { orgSchema } from "../../../src/cli/schemas/org.schema";
import { secretItemSchema } from "../../../src/cli/schemas/secrets.schema";
import { sessionItemSchema } from "../../../src/cli/schemas/sessions.schema";
import { sopItemSchema } from "../../../src/cli/schemas/sops.schema";
import {
  userItemSchema,
  usersFileSchema,
} from "../../../src/cli/schemas/users.schema";

describe("orgSchema", () => {
  test("validates correct input", () => {
    const result = orgSchema.safeParse({
      name: "Acme Corp",
      slug: "acme",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.demoEnabled).toBe(false);
    }
  });

  test("accepts optional fields", () => {
    const result = orgSchema.safeParse({
      name: "Acme",
      slug: "acme",
      timezone: "America/Chicago",
      features: ["voice-agents"],
      demoEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid slug", () => {
    const result = orgSchema.safeParse({
      name: "Acme",
      slug: "Acme Corp!",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing name", () => {
    const result = orgSchema.safeParse({ slug: "acme" });
    expect(result.success).toBe(false);
  });
});

describe("userItemSchema", () => {
  test("validates correct user", () => {
    const result = userItemSchema.safeParse({
      email: "alice@test.com",
      name: "Alice",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid role", () => {
    const result = userItemSchema.safeParse({
      email: "alice@test.com",
      name: "Alice",
      role: "superadmin",
    });
    expect(result.success).toBe(false);
  });

  test("rejects viewer role (not supported by service)", () => {
    const result = userItemSchema.safeParse({
      email: "alice@test.com",
      name: "Alice",
      role: "viewer",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid email", () => {
    const result = userItemSchema.safeParse({
      email: "not-an-email",
      name: "Alice",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });
});

describe("usersFileSchema", () => {
  test("validates file format", () => {
    const result = usersFileSchema.safeParse({
      users: [
        { email: "a@test.com", name: "A", role: "admin" },
        { email: "b@test.com", name: "B", role: "support" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty users array", () => {
    const result = usersFileSchema.safeParse({ users: [] });
    expect(result.success).toBe(false);
  });
});

describe("connectorItemSchema", () => {
  test("validates minimal connector", () => {
    const result = connectorItemSchema.safeParse({
      name: "Store",
      slug: "store",
      catalogSlug: "medusa",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toEqual({});
      expect(result.data.secrets).toEqual([]);
    }
  });

  test("validates connector with secrets", () => {
    const result = connectorItemSchema.safeParse({
      name: "Store",
      slug: "store",
      catalogSlug: "medusa",
      secrets: [{ field: "apiKey", name: "Key", type: "api_key" }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid slug format", () => {
    const result = connectorItemSchema.safeParse({
      name: "Store",
      slug: "Store-Name",
      catalogSlug: "medusa",
    });
    expect(result.success).toBe(false);
  });
});

describe("agentItemSchema", () => {
  test("validates minimal agent", () => {
    const result = agentItemSchema.safeParse({ name: "Voice Agent" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modality).toBe("voice");
      expect(result.data.platform).toBe("custom");
      expect(result.data.tools).toEqual([]);
    }
  });

  test("validates agent with tools", () => {
    const result = agentItemSchema.safeParse({
      name: "Agent",
      slug: "my-agent",
      tools: [{ connectorSlug: "store", toolSlugs: ["get_order"] }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid modality", () => {
    const result = agentItemSchema.safeParse({
      name: "Agent",
      modality: "video",
    });
    expect(result.success).toBe(false);
  });
});

describe("sopItemSchema", () => {
  test("validates template fork SOP", () => {
    const result = sopItemSchema.safeParse({
      name: "Order Lookup",
      templateSlug: "order-lookup",
      connectorMapping: { medusa: "store" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("draft");
      expect(result.data.agents).toEqual([]);
    }
  });

  test("validates inline SOP with steps", () => {
    const result = sopItemSchema.safeParse({
      name: "Return Process",
      steps: [{ id: "step-1", instruction: "Greet customer" }],
      trigger: { type: "manual", config: {} },
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid status", () => {
    const result = sopItemSchema.safeParse({
      name: "SOP",
      status: "deleted",
    });
    expect(result.success).toBe(false);
  });
});

describe("guardrailItemSchema", () => {
  test("validates correct guardrail", () => {
    const result = guardrailItemSchema.safeParse({
      name: "No Medical Claims",
      content: "Never claim products cure diseases.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toEqual({});
      expect(result.data.agents).toEqual([]);
    }
  });

  test("rejects missing content", () => {
    const result = guardrailItemSchema.safeParse({
      name: "Test",
    });
    expect(result.success).toBe(false);
  });
});

describe("sessionItemSchema", () => {
  test("validates correct session", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "voice-agent",
      channel: "voice",
      userIdentifier: "user@test.com",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("completed");
      expect(result.data.hoursAgo).toBe(1);
      expect(result.data.links).toEqual([]);
    }
  });

  test("accepts optional externalId", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "voice-agent",
      externalId: "demo-session-001",
      channel: "voice",
      userIdentifier: "user@test.com",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  test("validates session with feedback", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "agent",
      channel: "web",
      userIdentifier: "user",
      messages: [{ role: "user", content: "Hi" }],
      feedback: { verdict: "good", comment: "Great" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid channel", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "agent",
      channel: "fax",
      userIdentifier: "user",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty messages", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "agent",
      channel: "voice",
      userIdentifier: "user",
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid feedback verdict", () => {
    const result = sessionItemSchema.safeParse({
      agentSlug: "agent",
      channel: "voice",
      userIdentifier: "user",
      messages: [{ role: "user", content: "Hi" }],
      feedback: { verdict: "amazing" },
    });
    expect(result.success).toBe(false);
  });
});

describe("secretItemSchema", () => {
  test("validates correct secret", () => {
    const result = secretItemSchema.safeParse({
      name: "API Key",
      type: "api_key",
      scope: "connector",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid secret type", () => {
    const result = secretItemSchema.safeParse({
      name: "Key",
      type: "password",
    });
    expect(result.success).toBe(false);
  });
});
