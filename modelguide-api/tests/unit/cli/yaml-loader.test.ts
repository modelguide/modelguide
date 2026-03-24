import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { loadYaml } from "../../../src/cli/lib/yaml-loader";

const testSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive(),
  tags: z.array(z.string()).default([]),
});

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "yaml-loader-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true });
});

describe("loadYaml", () => {
  test("loads and validates correct YAML", () => {
    const filePath = path.join(tmpDir, "valid.yaml");
    writeFileSync(filePath, "name: Test\ncount: 5\ntags:\n  - a\n  - b\n");

    const result = loadYaml(filePath, testSchema);
    expect(result).toEqual({ name: "Test", count: 5, tags: ["a", "b"] });
  });

  test("applies defaults for missing optional fields", () => {
    const filePath = path.join(tmpDir, "defaults.yaml");
    writeFileSync(filePath, "name: Test\ncount: 3\n");

    const result = loadYaml(filePath, testSchema);
    expect(result.tags).toEqual([]);
  });

  test("throws on validation failure", () => {
    const filePath = path.join(tmpDir, "invalid.yaml");
    writeFileSync(filePath, "name: Test\ncount: -1\n");

    expect(() => loadYaml(filePath, testSchema)).toThrow("Validation failed");
  });

  test("throws on missing required fields", () => {
    const filePath = path.join(tmpDir, "missing.yaml");
    writeFileSync(filePath, "count: 5\n");

    expect(() => loadYaml(filePath, testSchema)).toThrow("Validation failed");
  });

  test("throws on invalid YAML syntax", () => {
    const filePath = path.join(tmpDir, "bad-syntax.yaml");
    writeFileSync(filePath, "name: [unclosed bracket\n");

    expect(() => loadYaml(filePath, testSchema)).toThrow();
  });

  test("throws on missing file", () => {
    expect(() =>
      loadYaml(path.join(tmpDir, "nonexistent.yaml"), testSchema),
    ).toThrow();
  });
});
