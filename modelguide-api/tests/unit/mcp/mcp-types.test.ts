/**
 * Unit tests for MCP response helpers
 */

import { describe, expect, test } from "bun:test";
import { mcpErrorResponse, mcpResponse } from "@features/mcp/mcp.types";
import { AppError, ErrorCode } from "@lib/errors";

describe("mcpResponse", () => {
  test("wraps data as JSON text content", () => {
    const result = mcpResponse({ session_id: "abc", status: "active" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.session_id).toBe("abc");
    expect(parsed.status).toBe("active");
  });

  test("does not set isError by default", () => {
    const result = mcpResponse({ ok: true });

    expect(result.isError).toBeUndefined();
  });

  test("sets isError when true", () => {
    const result = mcpResponse({ error: "something failed" }, true);

    expect(result.isError).toBe(true);
  });

  test("does not set isError when false", () => {
    const result = mcpResponse({ ok: true }, false);

    expect(result.isError).toBeUndefined();
  });

  test("handles empty data object", () => {
    const result = mcpResponse({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({});
  });

  test("handles nested data", () => {
    const result = mcpResponse({
      session: { id: "s1", messages: [{ role: "user" }] },
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.session.id).toBe("s1");
    expect(parsed.session.messages).toHaveLength(1);
  });
});

describe("mcpErrorResponse", () => {
  test("extracts message from AppError instances", () => {
    const err = new AppError(ErrorCode.SESSION_NOT_FOUND, "Session not found");
    const result = mcpErrorResponse(err, "Fallback message");

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Session not found");
  });

  test("uses fallback for plain Error (prevents internal detail leakage)", () => {
    const result = mcpErrorResponse(
      new Error('relation "sessions" does not exist'),
      "Operation failed",
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Operation failed");
  });

  test("uses fallback for non-Error values", () => {
    const result = mcpErrorResponse("some string", "Fallback message");

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Fallback message");
  });

  test("uses fallback for null", () => {
    const result = mcpErrorResponse(null, "Operation failed");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Operation failed");
  });

  test("uses fallback for undefined", () => {
    const result = mcpErrorResponse(undefined, "Unknown error");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Unknown error");
  });

  test("merges extra fields into response", () => {
    const err = new AppError(ErrorCode.NOT_FOUND, "Not found");
    const result = mcpErrorResponse(err, "Fallback", {
      tool_name: "core_end_session",
      session_id: "abc",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Not found");
    expect(parsed.tool_name).toBe("core_end_session");
    expect(parsed.session_id).toBe("abc");
  });

  test("works without extra fields", () => {
    const err = new AppError(ErrorCode.SESSION_NOT_FOUND, "Oops");
    const result = mcpErrorResponse(err, "Fallback");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Oops");
    expect(Object.keys(parsed)).toEqual(["error"]);
  });
});
