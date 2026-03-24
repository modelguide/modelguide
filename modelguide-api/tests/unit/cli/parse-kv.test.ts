import { describe, expect, test } from "bun:test";
import { parseKv, parseKvArgs } from "../../../src/cli/lib/parse-kv";

describe("parseKv", () => {
  test("parses simple key=value pairs", () => {
    expect(parseKv("name=Alice,role=admin")).toEqual({
      name: "Alice",
      role: "admin",
    });
  });

  test("splits on first = only (values can contain =)", () => {
    expect(parseKv("url=https://example.com?foo=bar")).toEqual({
      url: "https://example.com?foo=bar",
    });
  });

  test("handles escaped commas in values", () => {
    expect(parseKv("name=Acme\\, Inc.,type=api_key")).toEqual({
      name: "Acme, Inc.",
      type: "api_key",
    });
  });

  test("handles empty values", () => {
    expect(parseKv("name=,type=api_key")).toEqual({
      name: "",
      type: "api_key",
    });
  });

  test("handles single key=value pair", () => {
    expect(parseKv("email=alice@test.com")).toEqual({
      email: "alice@test.com",
    });
  });

  test("throws on missing = sign", () => {
    expect(() => parseKv("invalidpair")).toThrow('missing "="');
  });

  test("throws on empty key", () => {
    expect(() => parseKv("=value")).toThrow("Empty key");
  });

  test("handles special characters in values", () => {
    expect(parseKv('config={"baseUrl":"https://api.example.com"}')).toEqual({
      config: '{"baseUrl":"https://api.example.com"}',
    });
  });

  test("trims whitespace from keys", () => {
    expect(parseKv(" name =Alice")).toEqual({ name: "Alice" });
  });

  test("preserves whitespace in values", () => {
    expect(parseKv("name= Alice Admin ")).toEqual({
      name: " Alice Admin ",
    });
  });
});

describe("parseKvArgs", () => {
  test("parses multiple args", () => {
    const result = parseKvArgs([
      "email=alice@test.com,name=Alice,role=admin",
      "email=bob@test.com,name=Bob,role=support",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].email).toBe("alice@test.com");
    expect(result[1].name).toBe("Bob");
  });

  test("returns empty array for no args", () => {
    expect(parseKvArgs([])).toEqual([]);
  });
});
