/**
 * Unit tests for extractConnectorToolIds (pure function, no DB).
 */

import { describe, expect, test } from "bun:test";
import { extractConnectorToolIds } from "@features/evals/evals.compile";

describe("extractConnectorToolIds", () => {
  test("returns ID when config has valid connectorToolId", () => {
    const ids = extractConnectorToolIds({
      connectorToolId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(ids).toEqual(["550e8400-e29b-41d4-a716-446655440000"]);
  });

  test("returns empty array for llm_judge shape (no connectorToolId)", () => {
    const ids = extractConnectorToolIds({
      criterion: "Agent was polite",
      rubric: { pass: "Good", fail: "Bad" },
    });
    expect(ids).toEqual([]);
  });

  test("returns empty array when connectorToolId is empty string", () => {
    const ids = extractConnectorToolIds({ connectorToolId: "" });
    expect(ids).toEqual([]);
  });

  test("returns empty array when connectorToolId is non-string", () => {
    const ids = extractConnectorToolIds({ connectorToolId: 42 });
    expect(ids).toEqual([]);
  });

  test("returns empty array for empty config", () => {
    const ids = extractConnectorToolIds({});
    expect(ids).toEqual([]);
  });
});
