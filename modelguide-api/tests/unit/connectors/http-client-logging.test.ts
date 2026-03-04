/**
 * Unit tests for http-client.ts logging behaviour.
 * Verifies that connectorFetch and withConnector emit the expected log lines.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";

// ── Test logger capture ────────────────────────────────────────────────

interface LogLine {
  level: string;
  msg: string;
  [key: string]: unknown;
}

function createTestLogger() {
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
      formatters: { level: (label) => ({ level: label }) },
    },
    stream,
  );

  return {
    logger,
    getLines: (): LogLine[] => lines.map((l) => JSON.parse(l)),
    getLast: (): LogLine => JSON.parse(lines[lines.length - 1]),
    clear: () => {
      lines.length = 0;
    },
  };
}

// ── Mock getLogger ────────────────────────────────────────────────────

const testLog = createTestLogger();

mock.module("@lib/logger", () => ({
  getLogger: () => testLog.logger,
  enrichLogger: () => {},
  withTiming: async <T>(
    log: pino.Logger,
    context: Record<string, unknown>,
    successMsg: string,
    errorMsg: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const start = performance.now();
    try {
      const result = await fn();
      log.info(
        { ...context, duration: Math.round(performance.now() - start) },
        successMsg,
      );
      return result;
    } catch (err) {
      log.error(
        { err, ...context, duration: Math.round(performance.now() - start) },
        errorMsg,
      );
      throw err;
    }
  },
}));

// Import AFTER mock so module resolution picks up the mock
const { createBaseFetcher, ConnectorApiError, withConnector } = await import(
  "@features/connectors/catalog/lib/http-client"
);

// ── Fetch mock ──────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  testLog.clear();
});

// ── Tests ───────────────────────────────────────────────────────────

describe("connectorFetch logging", () => {
  const BASE_URL = "https://api.test.com";
  const HEADERS = { Authorization: "Bearer test" };
  const CONNECTOR = "test-connector";

  function makeFetcher() {
    return createBaseFetcher(BASE_URL, HEADERS, CONNECTOR);
  }

  test("logs info on successful response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as typeof fetch;

    const fetcher = makeFetcher();
    await fetcher("/test");

    const lines = testLog.getLines();
    const infoLine = lines.find(
      (l) => l.level === "info" && l.msg === "connector call completed",
    );
    expect(infoLine).toBeDefined();
    expect(infoLine!.connector).toBe(CONNECTOR);
    expect(infoLine!.method).toBe("GET");
    expect(infoLine!.path).toBe("/test");
    expect(infoLine!.status).toBe(200);
    expect(typeof infoLine!.duration).toBe("number");
  });

  test("logs warn and throws on HTTP error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as typeof fetch;

    const fetcher = makeFetcher();

    await expect(fetcher("/missing")).rejects.toThrow(ConnectorApiError);

    const lines = testLog.getLines();
    const warnLine = lines.find(
      (l) => l.level === "warn" && l.msg === "connector call failed",
    );
    expect(warnLine).toBeDefined();
    expect(warnLine!.status).toBe(404);
    expect(warnLine!.connector).toBe(CONNECTOR);
  });

  test("logs error on network failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as typeof fetch;

    const fetcher = makeFetcher();

    await expect(fetcher("/down")).rejects.toThrow("ECONNREFUSED");

    const lines = testLog.getLines();
    const errorLine = lines.find(
      (l) => l.level === "error" && l.msg === "connector call error",
    );
    expect(errorLine).toBeDefined();
    expect(errorLine!.connector).toBe(CONNECTOR);
    expect(typeof errorLine!.duration).toBe("number");
  });
});

describe("withConnector logging", () => {
  test("logs warn when handler throws", async () => {
    const fakeFetcherFactory = () => {
      return (async () => ({})) as ReturnType<typeof createBaseFetcher>;
    };

    const handler = withConnector(fakeFetcherFactory)(async () => {
      throw new Error("validation failed");
    });

    const result = await handler({
      config: {},
      input: {},
      organizationId: "org-1",
      connectorId: "conn-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("validation failed");

    const lines = testLog.getLines();
    const warnLine = lines.find(
      (l) => l.level === "warn" && l.msg === "connector handler error",
    );
    expect(warnLine).toBeDefined();
  });

  test("does not log when handler succeeds", async () => {
    const fakeFetcherFactory = () => {
      return (async () => ({})) as ReturnType<typeof createBaseFetcher>;
    };

    const handler = withConnector(fakeFetcherFactory)(async () => {
      return { success: true, data: { id: "123" } };
    });

    const result = await handler({
      config: {},
      input: {},
      organizationId: "org-1",
      connectorId: "conn-1",
    });

    expect(result.success).toBe(true);

    const lines = testLog.getLines();
    const warnLine = lines.find(
      (l) => l.level === "warn" && l.msg === "connector handler error",
    );
    expect(warnLine).toBeUndefined();
  });
});
