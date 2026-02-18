/**
 * Unit tests for connector health check functions.
 * Mocks globalThis.fetch to test without real external services.
 */

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import medusaManifest from "@features/connectors/catalog/medusa/index";
import zendeskManifest from "@features/connectors/catalog/zendesk/index";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetchSuccess(responseData: Record<string, unknown>) {
  fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = fetchMock as typeof fetch;
}

function mockFetchError(status: number, body: string) {
  fetchMock = mock(() => Promise.resolve(new Response(body, { status })));
  globalThis.fetch = fetchMock as typeof fetch;
}

function mockFetchTimeout() {
  fetchMock = mock(
    () =>
      new Promise<Response>((_, reject) =>
        reject(new Error("The operation timed out")),
      ),
  );
  globalThis.fetch = fetchMock as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// Medusa health check
// ============================================================================

describe("Medusa healthCheck", () => {
  const healthCheck = medusaManifest.healthCheck!;

  test("returns healthy on 200 response", async () => {
    mockFetchSuccess({ products: [], count: 0 });

    const result = await healthCheck({
      baseUrl: "https://api.test-store.com",
      publishableKey: "pk_test_abc",
    });

    expect(result.status).toBe("healthy");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
    expect(result.message).toBeUndefined();

    // Verify it called the correct endpoint
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/store/products");
    expect(url).toContain("limit=1");
  });

  test("returns error on API failure (500)", async () => {
    mockFetchError(500, "Internal Server Error");

    const result = await healthCheck({
      baseUrl: "https://api.test-store.com",
      publishableKey: "pk_test_abc",
    });

    expect(result.status).toBe("error");
    expect(result.message).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
  });

  test("returns error when baseUrl is missing", async () => {
    const result = await healthCheck({
      publishableKey: "pk_test_abc",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("baseUrl");
  });

  test("returns error on timeout", async () => {
    mockFetchTimeout();

    const result = await healthCheck({
      baseUrl: "https://api.test-store.com",
      publishableKey: "pk_test_abc",
    });

    expect(result.status).toBe("error");
    expect(result.message).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Zendesk health check
// ============================================================================

describe("Zendesk healthCheck", () => {
  const healthCheck = zendeskManifest.healthCheck!;

  const validConfig = {
    subdomain: "testcompany",
    email: "agent@test.com",
    apiToken: "tok_abc123",
  };

  test("returns healthy on 200 response", async () => {
    mockFetchSuccess({ account: { name: "Test Account" } });

    const result = await healthCheck(validConfig);

    expect(result.status).toBe("healthy");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
    expect(result.message).toBeUndefined();

    // Verify it called the correct endpoint
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("testcompany.zendesk.com");
    expect(url).toContain("/account");
  });

  test("returns error on auth failure (401)", async () => {
    mockFetchError(401, "Unauthorized");

    const result = await healthCheck(validConfig);

    expect(result.status).toBe("error");
    expect(result.message).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("returns error when config fields are missing", async () => {
    const result = await healthCheck({
      subdomain: "testcompany",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("email");
  });
});
