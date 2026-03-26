import { describe, expect, test } from "bun:test";
import { buildImportedSessionExternalId } from "../../../src/cli/lib/session-external-id";
import type { SessionItemInput } from "../../../src/cli/schemas/sessions.schema";

function buildSession(
  overrides: Partial<SessionItemInput> = {},
): SessionItemInput {
  return {
    agentSlug: "session-test-agent",
    channel: "voice",
    status: "completed",
    userIdentifier: "user-123",
    hoursAgo: 2,
    messages: [{ role: "user", content: "Hello" }],
    links: [],
    ...overrides,
  };
}

describe("buildImportedSessionExternalId", () => {
  test("uses explicit externalId when provided", () => {
    const session = buildSession({ externalId: "demo-session-001" });
    expect(buildImportedSessionExternalId(session)).toBe("demo-session-001");
  });

  test("derives a stable ID for the same payload", () => {
    const session = buildSession();
    expect(buildImportedSessionExternalId(session)).toBe(
      buildImportedSessionExternalId(session),
    );
  });

  test("changes when the payload changes", () => {
    const baseline = buildImportedSessionExternalId(buildSession());
    const changed = buildImportedSessionExternalId(
      buildSession({
        messages: [{ role: "user", content: "Different content" }],
      }),
    );

    expect(changed).not.toBe(baseline);
  });
});
