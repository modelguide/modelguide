/**
 * Tests for error utilities
 */

import { describe, expect, test } from "bun:test";
import { AppError, ErrorCode, Errors, isAppError } from "@lib/errors";

describe("AppError", () => {
  test("creates error with correct code and status", () => {
    const error = new AppError(ErrorCode.UNAUTHORIZED, "Not authenticated");
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Not authenticated");
  });

  test("includes details when provided", () => {
    const details = { field: "email", reason: "invalid format" };
    const error = new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Invalid input",
      details,
    );
    expect(error.details).toEqual(details);
  });

  test("toJSON returns correct structure", () => {
    const error = new AppError(ErrorCode.NOT_FOUND, "Resource not found");
    const json = error.toJSON();
    expect(json).toEqual({
      code: ErrorCode.NOT_FOUND,
      message: "Resource not found",
    });
  });

  test("toJSON includes details when present", () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, "Invalid", {
      field: "name",
    });
    const json = error.toJSON();
    expect(json.details).toEqual({ field: "name" });
  });
});

describe("Error status codes", () => {
  test("401 errors have correct status", () => {
    expect(new AppError(ErrorCode.UNAUTHORIZED, "").status).toBe(401);
    expect(new AppError(ErrorCode.INVALID_TOKEN, "").status).toBe(401);
    expect(new AppError(ErrorCode.TOKEN_EXPIRED, "").status).toBe(401);
    expect(new AppError(ErrorCode.AGENT_KEY_INVALID, "").status).toBe(401);
    expect(new AppError(ErrorCode.MAGIC_TOKEN_INVALID, "").status).toBe(401);
  });

  test("403 errors have correct status", () => {
    expect(new AppError(ErrorCode.FORBIDDEN, "").status).toBe(403);
    expect(new AppError(ErrorCode.AGENT_INACTIVE, "").status).toBe(403);
    expect(new AppError(ErrorCode.USER_INACTIVE, "").status).toBe(403);
  });

  test("404 errors have correct status", () => {
    expect(new AppError(ErrorCode.NOT_FOUND, "").status).toBe(404);
    expect(new AppError(ErrorCode.AGENT_NOT_FOUND, "").status).toBe(404);
    expect(new AppError(ErrorCode.USER_NOT_FOUND, "").status).toBe(404);
    expect(new AppError(ErrorCode.SESSION_NOT_FOUND, "").status).toBe(404);
  });

  test("400 errors have correct status", () => {
    expect(new AppError(ErrorCode.VALIDATION_ERROR, "").status).toBe(400);
    expect(new AppError(ErrorCode.INVALID_INPUT, "").status).toBe(400);
    expect(
      new AppError(ErrorCode.ORGANIZATION_HEADER_REQUIRED, "").status,
    ).toBe(400);
  });

  test("500 errors have correct status", () => {
    expect(new AppError(ErrorCode.INTERNAL_ERROR, "").status).toBe(500);
    expect(new AppError(ErrorCode.TOOL_EXECUTION_FAILED, "").status).toBe(500);
  });
});

describe("Error factory functions", () => {
  test("Errors.unauthorized creates correct error", () => {
    const error = Errors.unauthorized();
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(error.status).toBe(401);
  });

  test("Errors.notFound creates correct error", () => {
    const error = Errors.notFound("User", "123");
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(error.message).toBe("User not found: 123");
  });

  test("Errors.validationError includes details", () => {
    const error = Errors.validationError("Invalid data", { field: "email" });
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.details).toEqual({ field: "email" });
  });

  test("Errors.agentNotFound creates correct error", () => {
    const error = Errors.agentNotFound("abc-123");
    expect(error.code).toBe(ErrorCode.AGENT_NOT_FOUND);
    expect(error.message).toContain("abc-123");
  });

  test("Errors.magicTokenExpired creates correct error", () => {
    const error = Errors.magicTokenExpired();
    expect(error.code).toBe(ErrorCode.MAGIC_TOKEN_EXPIRED);
    expect(error.status).toBe(401);
  });
});

describe("isAppError", () => {
  test("returns true for AppError instances", () => {
    const error = new AppError(ErrorCode.NOT_FOUND, "Not found");
    expect(isAppError(error)).toBe(true);
  });

  test("returns false for regular Error instances", () => {
    const error = new Error("Regular error");
    expect(isAppError(error)).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isAppError("string")).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError({})).toBe(false);
  });
});
