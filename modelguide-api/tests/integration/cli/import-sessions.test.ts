/**
 * Integration tests for mg import-sessions command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  organizations,
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
  users,
} from "@db/schema";
import { and, eq } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { handleImportSessions } from "../../../src/cli/commands/import-sessions";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-sessions-test-${Date.now()}`;
let orgId: string;
let registry: IdRegistry;

beforeAll(async () => {
  registry = new IdRegistry();

  const org = await handleCreateOrg(
    { name: "CLI Sessions Test", slug: TEST_SLUG, demoEnabled: false },
    registry,
  );
  orgId = org.id;

  await handleAddUsers(
    orgId,
    [
      {
        email: "session-admin@test.com",
        name: "Session Admin",
        role: "admin",
      },
    ],
    registry,
  );

  await handleAddAgents(
    orgId,
    [
      {
        name: "Session Test Agent",
        slug: "session-test-agent",
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [],
      },
    ],
    { registry },
  );
});

afterAll(async () => {
  await forApp(async (tx) => {
    const orgSessions = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.organizationId, orgId));
    for (const s of orgSessions) {
      await tx
        .delete(sessionFeedback)
        .where(eq(sessionFeedback.sessionId, s.id));
      await tx
        .delete(sessionMessages)
        .where(eq(sessionMessages.sessionId, s.id));
    }
    await tx.delete(sessions).where(eq(sessions.organizationId, orgId));

    const orgAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organizationId, orgId));
    for (const a of orgAgents) {
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.agentId, a.id));
      await tx.delete(apiKeys).where(eq(apiKeys.agentId, a.id));
    }
    await tx.delete(agents).where(eq(agents.organizationId, orgId));
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("import-sessions", () => {
  test("creates session with messages", async () => {
    const result = await handleImportSessions(
      orgId,
      [
        {
          agentSlug: "session-test-agent",
          channel: "voice",
          status: "completed",
          userIdentifier: "user-123",
          hoursAgo: 2,
          messages: [
            { role: "user", content: "Hello, I need help with my order" },
            {
              role: "assistant",
              content: "I'd be happy to help! What's your order number?",
            },
            { role: "user", content: "ORD-12345" },
          ],
          links: [
            {
              url: "https://example.com/orders/ORD-12345",
              title: "Order ORD-12345",
              connectorSlug: "store",
              resourceType: "order",
            },
          ],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);

    // Verify messages in DB
    const orgSessions = await forApp(async (tx) => {
      return tx
        .select()
        .from(sessions)
        .where(eq(sessions.organizationId, orgId));
    });
    expect(orgSessions.length).toBe(1);

    const msgs = await forApp(async (tx) => {
      return tx
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, orgSessions[0].id));
    });
    expect(msgs.length).toBe(3);

    const links = await forApp(async (tx) => {
      return tx
        .select()
        .from(sessionLinks)
        .where(eq(sessionLinks.sessionId, orgSessions[0].id));
    });
    expect(links.length).toBe(1);
    expect(links[0].url).toBe("https://example.com/orders/ORD-12345");
  });

  test("creates session with feedback", async () => {
    const result = await handleImportSessions(
      orgId,
      [
        {
          agentSlug: "session-test-agent",
          channel: "web",
          status: "completed",
          userIdentifier: "user-456",
          hoursAgo: 1,
          messages: [
            { role: "user", content: "Quick question" },
            { role: "assistant", content: "Sure, go ahead!" },
          ],
          feedback: {
            verdict: "good",
            comment: "Great service!",
            source: "customer",
          },
          links: [],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);

    // Verify feedback in DB — query by userIdentifier to avoid ordering assumptions
    const [feedbackSession] = await forApp(async (tx) => {
      return tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, orgId),
            eq(sessions.userIdentifier, "user-456"),
          ),
        );
    });

    const feedbackRows = await forApp(async (tx) => {
      return tx
        .select()
        .from(sessionFeedback)
        .where(eq(sessionFeedback.sessionId, feedbackSession.id));
    });
    expect(feedbackRows.length).toBe(1);
    expect(feedbackRows[0].rating).toBe(2);
  });

  test("standalone agent lookup without registry", async () => {
    const result = await handleImportSessions(orgId, [
      {
        agentSlug: "session-test-agent",
        channel: "api",
        status: "active",
        userIdentifier: "user-789",
        hoursAgo: 1,
        messages: [
          { role: "user", content: "Standalone test" },
          { role: "assistant", content: "Working without registry!" },
        ],
        links: [],
      },
    ]);

    expect(result.created).toBe(1);
  });

  test("re-importing the same session is idempotent", async () => {
    const item = {
      agentSlug: "session-test-agent",
      externalId: "demo-session-001",
      channel: "web" as const,
      status: "completed" as const,
      userIdentifier: "user-duplicate-check",
      hoursAgo: 1,
      messages: [{ role: "user" as const, content: "Hello again" }],
      links: [],
    };

    const first = await handleImportSessions(orgId, [item], { registry });
    const second = await handleImportSessions(orgId, [item], { registry });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
  });

  test("skips session for unknown agent", async () => {
    const result = await handleImportSessions(
      orgId,
      [
        {
          agentSlug: "nonexistent-agent",
          channel: "voice",
          status: "completed",
          userIdentifier: "user-000",
          hoursAgo: 1,
          messages: [{ role: "user", content: "This should be skipped" }],
          links: [],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(0);
  });
});
