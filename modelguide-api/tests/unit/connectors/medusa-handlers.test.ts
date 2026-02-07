/**
 * Unit tests for Medusa connector handlers.
 * Mocks globalThis.fetch to verify correct API calls without a real Medusa server.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  addToCart,
  completeCart,
  createCart,
  getCart,
  getOrder,
  getProduct,
  listProducts,
  setDeliveryAddress,
} from "@features/connectors/catalog/medusa/handlers";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";

const BASE_CONFIG: Record<string, string> = {
  baseUrl: "https://api.test-store.com",
  apiToken: "test-token-123",
  publishableKey: "pk_test_abc",
};

function makeCtx(
  input: Record<string, unknown> = {},
  config = BASE_CONFIG,
): ToolExecutionContext {
  return {
    config,
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

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

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("Medusa handlers", () => {
  // ----------------------------------------------------------------
  // List Products
  // ----------------------------------------------------------------
  describe("listProducts", () => {
    test("calls GET /store/products with default params", async () => {
      mockFetchSuccess({ products: [], count: 0 });
      const result = await listProducts(makeCtx());
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/store/products");
      expect(url).toContain("limit=20");
      expect(url).toContain("offset=0");
      expect(opts.method).toBe("GET");
    });

    test("passes search query param", async () => {
      mockFetchSuccess({ products: [] });
      await listProducts(makeCtx({ q: "shirt", limit: 5, offset: 10 }));

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("q=shirt");
      expect(url).toContain("limit=5");
      expect(url).toContain("offset=10");
    });

    test("includes auth headers", async () => {
      mockFetchSuccess({ products: [] });
      await listProducts(makeCtx());

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers.Authorization).toBe("Bearer test-token-123");
      expect(opts.headers["x-publishable-api-key"]).toBe("pk_test_abc");
    });
  });

  // ----------------------------------------------------------------
  // Get Product
  // ----------------------------------------------------------------
  describe("getProduct", () => {
    test("calls GET /store/products/:id", async () => {
      mockFetchSuccess({ product: { id: "prod_123" } });
      const result = await getProduct(makeCtx({ productId: "prod_123" }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.test-store.com/store/products/prod_123");
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Create Cart
  // ----------------------------------------------------------------
  describe("createCart", () => {
    test("calls POST /store/carts", async () => {
      mockFetchSuccess({ cart: { id: "cart_abc" } });
      const result = await createCart(
        makeCtx({ regionId: "reg_us", currencyCode: "usd" }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.test-store.com/store/carts");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.region_id).toBe("reg_us");
      expect(body.currency_code).toBe("usd");
    });

    test("sends empty body when no params", async () => {
      mockFetchSuccess({ cart: { id: "cart_abc" } });
      await createCart(makeCtx());

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body).toEqual({});
    });
  });

  // ----------------------------------------------------------------
  // Add to Cart
  // ----------------------------------------------------------------
  describe("addToCart", () => {
    test("calls POST /store/carts/:id/line-items", async () => {
      mockFetchSuccess({ cart: { id: "cart_abc" } });
      const result = await addToCart(
        makeCtx({ cartId: "cart_abc", variantId: "var_1", quantity: 2 }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.test-store.com/store/carts/cart_abc/line-items",
      );
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.variant_id).toBe("var_1");
      expect(body.quantity).toBe(2);
    });
  });

  // ----------------------------------------------------------------
  // Get Cart
  // ----------------------------------------------------------------
  describe("getCart", () => {
    test("calls GET /store/carts/:id", async () => {
      mockFetchSuccess({ cart: { id: "cart_abc", items: [] } });
      const result = await getCart(makeCtx({ cartId: "cart_abc" }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.test-store.com/store/carts/cart_abc");
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Set Delivery Address
  // ----------------------------------------------------------------
  describe("setDeliveryAddress", () => {
    test("calls POST /store/carts/:id with snake_case address", async () => {
      mockFetchSuccess({ cart: { id: "cart_abc" } });
      const result = await setDeliveryAddress(
        makeCtx({
          cartId: "cart_abc",
          address: {
            firstName: "John",
            lastName: "Doe",
            address1: "123 Main St",
            city: "New York",
            postalCode: "10001",
            countryCode: "us",
            phone: "+1234567890",
          },
        }),
      );
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.test-store.com/store/carts/cart_abc");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.shipping_address.first_name).toBe("John");
      expect(body.shipping_address.last_name).toBe("Doe");
      expect(body.shipping_address.address_1).toBe("123 Main St");
      expect(body.shipping_address.city).toBe("New York");
      expect(body.shipping_address.postal_code).toBe("10001");
      expect(body.shipping_address.country_code).toBe("us");
      expect(body.shipping_address.phone).toBe("+1234567890");
    });
  });

  // ----------------------------------------------------------------
  // Complete Cart
  // ----------------------------------------------------------------
  describe("completeCart", () => {
    test("calls POST /store/carts/:id/complete", async () => {
      mockFetchSuccess({ type: "order", order: { id: "order_1" } });
      const result = await completeCart(makeCtx({ cartId: "cart_abc" }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.test-store.com/store/carts/cart_abc/complete",
      );
      expect(opts.method).toBe("POST");
    });
  });

  // ----------------------------------------------------------------
  // Get Order
  // ----------------------------------------------------------------
  describe("getOrder", () => {
    test("calls GET /store/orders/:id", async () => {
      mockFetchSuccess({ order: { id: "order_1", status: "completed" } });
      const result = await getOrder(makeCtx({ orderId: "order_1" }));
      expect(result.success).toBe(true);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.test-store.com/store/orders/order_1");
      expect(opts.method).toBe("GET");
    });
  });

  // ----------------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------------
  describe("error handling", () => {
    test("returns error result on API 404", async () => {
      mockFetchError(404, '{"message":"Not found"}');
      const result = await getProduct(makeCtx({ productId: "nonexistent" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    test("returns error result on API 500", async () => {
      mockFetchError(500, "Internal Server Error");
      const result = await listProducts(makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    test("returns error when baseUrl is missing", async () => {
      const result = await listProducts(makeCtx({}, { apiToken: "token" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("baseUrl");
    });

    test("returns error on network failure", async () => {
      fetchMock = mock(() => Promise.reject(new Error("Network error")));
      globalThis.fetch = fetchMock as typeof fetch;

      const result = await getCart(makeCtx({ cartId: "cart_abc" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
