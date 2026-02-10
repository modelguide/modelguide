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
  lookUpOrder,
  setDeliveryAddress,
} from "@features/connectors/catalog/medusa/handlers";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";

const BASE_CONFIG: Record<string, string> = {
  baseUrl: "https://api.test-store.com",
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
      await listProducts(makeCtx({ query: "shirt", limit: 5, offset: 10 }));

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("q=shirt");
      expect(url).toContain("limit=5");
      expect(url).toContain("offset=10");
    });

    test("includes publishable key header", async () => {
      mockFetchSuccess({ products: [] });
      await listProducts(makeCtx());

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers["x-publishable-api-key"]).toBe("pk_test_abc");
      expect(opts.headers.Authorization).toBeUndefined();
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
      const result = await listProducts(
        makeCtx({}, { publishableKey: "pk_test" }),
      );
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

// ====================================================================
// Admin API — lookUpOrder
// ====================================================================

const ADMIN_CONFIG: Record<string, string> = {
  baseUrl: "https://api.test-store.com",
  publishableKey: "pk_test_abc",
  secretApiKey: "sk_admin_token_123",
};

function makeAdminCtx(
  input: Record<string, unknown> = {},
  config = ADMIN_CONFIG,
): ToolExecutionContext {
  return {
    config,
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

/**
 * Queues sequential fetch responses — each call to fetch consumes the next
 * response in order. Useful for handlers that make multiple API calls.
 */
function mockFetchSequence(
  responses: Array<{ status: number; body: unknown }>,
) {
  let callIndex = 0;
  fetchMock = mock(() => {
    const res = responses[callIndex++];
    if (!res) {
      return Promise.reject(new Error("Unexpected extra fetch call"));
    }
    return Promise.resolve(
      new Response(
        typeof res.body === "string" ? res.body : JSON.stringify(res.body),
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  });
  globalThis.fetch = fetchMock as typeof fetch;
}

describe("lookUpOrder (Admin API)", () => {
  // ----------------------------------------------------------------
  // Happy path
  // ----------------------------------------------------------------
  test("finds order on first page with items included", async () => {
    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_1" }] } },
      {
        status: 200,
        body: {
          orders: [
            {
              id: "order_aaa",
              display_id: 1001,
              status: "completed",
              total: 4500,
              currency_code: "usd",
              items: [
                {
                  id: "item_1",
                  title: "Margherita",
                  quantity: 2,
                  unit_price: 1500,
                },
              ],
            },
            { id: "order_bbb", display_id: 1002 },
          ],
          count: 2,
        },
      },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: "order_aaa",
      display_id: 1001,
      status: "completed",
      total: 4500,
      items: [{ id: "item_1", title: "Margherita", quantity: 2 }],
    });

    // Verify auth header uses Basic auth (not publishable key)
    const [, customerOpts] = fetchMock.mock.calls[0];
    expect(customerOpts.headers.Authorization).toBe(
      `Basic ${btoa("sk_admin_token_123:")}`,
    );
    expect(customerOpts.headers["x-publishable-api-key"]).toBeUndefined();

    // Verify correct URLs
    const [customerUrl] = fetchMock.mock.calls[0];
    expect(customerUrl).toContain("/admin/customers");
    expect(customerUrl).toContain("email=alice%40example.com");

    const [ordersUrl] = fetchMock.mock.calls[1];
    expect(ordersUrl).toContain("/admin/orders");
    expect(ordersUrl).toContain("customer_id=cust_1");
    expect(ordersUrl).toContain("fields=");
    expect(ordersUrl).toContain("*items");

    // Only 2 fetches: customers + orders (no separate detail call)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------
  // Pagination — order found on second page
  // ----------------------------------------------------------------
  test("paginates and finds order on second page", async () => {
    // Build 50 orders for page 1, none matching display_id 1099
    const page1Orders = Array.from({ length: 50 }, (_, i) => ({
      id: `order_p1_${i}`,
      display_id: 2000 + i,
    }));

    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_2" }] } },
      { status: 200, body: { orders: page1Orders, count: 55 } },
      {
        status: 200,
        body: {
          orders: [
            {
              id: "order_p2_0",
              display_id: 1099,
              status: "pending",
              items: [],
            },
            { id: "order_p2_1", display_id: 1100 },
          ],
          count: 55,
        },
      },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "bob@example.com", displayId: 1099 }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: "order_p2_0", display_id: 1099 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // customers + page1 + page2

    // Verify second orders call has correct offset
    const [page2Url] = fetchMock.mock.calls[2];
    expect(page2Url).toContain("offset=50");
  });

  // ----------------------------------------------------------------
  // No customer found
  // ----------------------------------------------------------------
  test("returns error when no customer matches email", async () => {
    mockFetchSequence([{ status: 200, body: { customers: [] } }]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "nobody@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("No customer found with this email");
    expect(fetchMock).toHaveBeenCalledTimes(1); // only customer lookup
  });

  // ----------------------------------------------------------------
  // Order not found after exhausting all pages
  // ----------------------------------------------------------------
  test("returns error when order not found across all pages", async () => {
    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_3" }] } },
      {
        status: 200,
        body: {
          orders: [
            { id: "order_x", display_id: 5000 },
            { id: "order_y", display_id: 5001 },
          ],
          count: 2,
        },
      },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "carol@example.com", displayId: 9999 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Order #9999 not found for customer carol@example.com",
    );
  });

  // ----------------------------------------------------------------
  // Customer has zero orders
  // ----------------------------------------------------------------
  test("returns error when customer has zero orders", async () => {
    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_empty" }] } },
      { status: 200, body: { orders: [], count: 0 } },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "empty@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Order #1001 not found for customer empty@example.com",
    );
  });

  // ----------------------------------------------------------------
  // Multiple customers — uses first match
  // ----------------------------------------------------------------
  test("uses first customer when multiple are returned", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          customers: [{ id: "cust_primary" }, { id: "cust_secondary" }],
        },
      },
      {
        status: 200,
        body: {
          orders: [
            {
              id: "order_match",
              display_id: 42,
              status: "completed",
              items: [],
            },
          ],
          count: 1,
        },
      },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "multi@example.com", displayId: 42 }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ id: "order_match" });

    // Verify it used the first customer's ID
    const [ordersUrl] = fetchMock.mock.calls[1];
    expect(ordersUrl).toContain("customer_id=cust_primary");
  });

  // ----------------------------------------------------------------
  // Missing secretApiKey
  // ----------------------------------------------------------------
  test("returns error when secretApiKey is missing", async () => {
    const result = await lookUpOrder(
      makeAdminCtx(
        { email: "alice@example.com", displayId: 1001 },
        { baseUrl: "https://api.test-store.com", publishableKey: "pk_test" },
      ),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("secretApiKey");
  });

  // ----------------------------------------------------------------
  // Missing baseUrl
  // ----------------------------------------------------------------
  test("returns error when baseUrl is missing", async () => {
    const result = await lookUpOrder(
      makeAdminCtx(
        { email: "alice@example.com", displayId: 1001 },
        { secretApiKey: "sk_token", publishableKey: "pk_test" },
      ),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("baseUrl");
  });

  // ----------------------------------------------------------------
  // API error on customer lookup (e.g. 401 Unauthorized)
  // ----------------------------------------------------------------
  test("returns error on customer API 401", async () => {
    mockFetchSequence([{ status: 401, body: '{"message":"Unauthorized"}' }]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  // ----------------------------------------------------------------
  // API error on orders lookup (e.g. 500)
  // ----------------------------------------------------------------
  test("returns error on orders API 500", async () => {
    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_1" }] } },
      { status: 500, body: "Internal Server Error" },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  // ----------------------------------------------------------------
  // Network failure
  // ----------------------------------------------------------------
  test("returns error on network failure", async () => {
    // First call succeeds (customers), second rejects
    let callIndex = 0;
    fetchMock = mock(() => {
      if (callIndex++ === 0) {
        return Promise.resolve(
          new Response(JSON.stringify({ customers: [{ id: "cust_1" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error("Connection refused"));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  // ----------------------------------------------------------------
  // API error on orders fetch
  // ----------------------------------------------------------------
  test("returns error when orders fetch fails with 502", async () => {
    mockFetchSequence([
      { status: 200, body: { customers: [{ id: "cust_1" }] } },
      { status: 502, body: "Bad Gateway" },
    ]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("502");
  });

  // ----------------------------------------------------------------
  // API error on customer lookup (403 Forbidden)
  // ----------------------------------------------------------------
  test("returns error on customer API 403", async () => {
    mockFetchSequence([{ status: 403, body: '{"message":"Forbidden"}' }]);

    const result = await lookUpOrder(
      makeAdminCtx({ email: "alice@example.com", displayId: 1001 }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("403");
  });
});
