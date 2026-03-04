/**
 * Tests for structured logger (Pino)
 */

import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";

/** Create a pino instance that writes JSON lines to a buffer for assertion. */
function createTestLogger(opts?: pino.LoggerOptions) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const logger = pino(
    {
      level: "trace",
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      ...opts,
    },
    stream,
  );

  return {
    logger,
    lines,
    parseLast: () => JSON.parse(lines[lines.length - 1]),
  };
}

describe("logger redaction", () => {
  const redactOpts: pino.LoggerOptions = {
    redact: {
      paths: [
        "authorization",
        "cookie",
        "encryptedValue",
        "password",
        "token",
        "apiKey",
      ],
      censor: "[REDACTED]",
    },
  };

  test("redacts sensitive fields", () => {
    const { logger, parseLast } = createTestLogger(redactOpts);

    logger.info(
      {
        authorization: "Bearer secret-jwt",
        cookie: "session=abc123",
        password: "hunter2",
        apiKey: "mgk_secret",
        encryptedValue: "aes-encrypted-blob",
      },
      "test redaction",
    );

    const entry = parseLast();
    expect(entry.authorization).toBe("[REDACTED]");
    expect(entry.cookie).toBe("[REDACTED]");
    expect(entry.password).toBe("[REDACTED]");
    expect(entry.apiKey).toBe("[REDACTED]");
    expect(entry.encryptedValue).toBe("[REDACTED]");
  });

  test("does not redact non-sensitive fields", () => {
    const { logger, parseLast } = createTestLogger(redactOpts);

    logger.info({ userId: "user-123", action: "login" }, "safe data");

    const entry = parseLast();
    expect(entry.userId).toBe("user-123");
    expect(entry.action).toBe("login");
  });
});

describe("child logger", () => {
  test("includes parent fields in child output", () => {
    const { logger, parseLast } = createTestLogger();

    const child = logger.child({ requestId: "req-abc-123" });
    child.info("hello from child");

    const entry = parseLast();
    expect(entry.requestId).toBe("req-abc-123");
    expect(entry.msg).toBe("hello from child");
  });
});

describe("log levels", () => {
  test("suppresses messages below configured level", () => {
    const { logger, lines } = createTestLogger({ level: "warn" });

    logger.info("should be suppressed");
    logger.debug("also suppressed");
    expect(lines.length).toBe(0);

    logger.warn("this should appear");
    expect(lines.length).toBe(1);
  });

  test("silent level suppresses all messages", () => {
    const { logger, lines } = createTestLogger({ level: "silent" });

    logger.fatal("even fatal is suppressed");
    expect(lines.length).toBe(0);
  });
});

describe("formatters", () => {
  test("level formatter outputs string labels", () => {
    const { logger, parseLast } = createTestLogger();

    logger.info("test");
    const entry = parseLast();
    expect(entry.level).toBe("info");
    expect(typeof entry.level).toBe("string");
  });
});
