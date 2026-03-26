import { describe, expect, test } from "bun:test";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

describe("IdRegistry", () => {
  test("set and get", () => {
    const reg = new IdRegistry();
    reg.set("org", "acme", "uuid-123");
    expect(reg.get("org", "acme")).toBe("uuid-123");
  });

  test("has returns true for existing entries", () => {
    const reg = new IdRegistry();
    reg.set("agent", "voice-agent", "uuid-456");
    expect(reg.has("agent", "voice-agent")).toBe(true);
  });

  test("has returns false for missing entries", () => {
    const reg = new IdRegistry();
    expect(reg.has("org", "nonexistent")).toBe(false);
  });

  test("has returns false for missing entity types", () => {
    const reg = new IdRegistry();
    expect(reg.has("connector", "any")).toBe(false);
  });

  test("get throws on missing slug", () => {
    const reg = new IdRegistry();
    expect(() => reg.get("org", "nonexistent")).toThrow(
      'org with slug "nonexistent" not found in registry',
    );
  });

  test("get throws on missing entity type", () => {
    const reg = new IdRegistry();
    expect(() => reg.get("connector", "any")).toThrow("not found in registry");
  });

  test("overwrites existing entries", () => {
    const reg = new IdRegistry();
    reg.set("org", "acme", "uuid-1");
    reg.set("org", "acme", "uuid-2");
    expect(reg.get("org", "acme")).toBe("uuid-2");
  });

  test("getAll returns all entries for a type", () => {
    const reg = new IdRegistry();
    reg.set("user", "alice", "uuid-a");
    reg.set("user", "bob", "uuid-b");
    const all = reg.getAll("user");
    expect(all.size).toBe(2);
    expect(all.get("alice")).toBe("uuid-a");
    expect(all.get("bob")).toBe("uuid-b");
  });

  test("getAll returns empty map for missing type", () => {
    const reg = new IdRegistry();
    expect(reg.getAll("secret").size).toBe(0);
  });

  test("different entity types are independent", () => {
    const reg = new IdRegistry();
    reg.set("org", "acme", "org-uuid");
    reg.set("agent", "acme", "agent-uuid");
    expect(reg.get("org", "acme")).toBe("org-uuid");
    expect(reg.get("agent", "acme")).toBe("agent-uuid");
  });
});
