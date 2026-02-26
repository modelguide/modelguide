/**
 * Medusa v2 tool handlers (Store + Admin API).
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import { withConnector } from "../lib/http-client";
import { runHealthCheck } from "../lib/run-health-check";
import type { HealthCheckResult } from "../types";
import { createMedusaAdminFetcher, createMedusaFetcher } from "./client";

const withMedusa = withConnector(createMedusaFetcher);

export const listProducts = withMedusa(async (fetcher, ctx) => {
  const input = ctx.input as {
    limit?: number;
    offset?: number;
    query: string;
  };
  const data = await fetcher<Record<string, unknown>>("/store/products", {
    params: {
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
      q: input.query,
    },
  });
  return { success: true, data };
});

export const getProduct = withMedusa(async (fetcher, ctx) => {
  const { productId } = ctx.input as { productId: string };
  const data = await fetcher<Record<string, unknown>>(
    `/store/products/${productId}`,
  );
  return { success: true, data };
});

export const createCart = withMedusa(async (fetcher, ctx) => {
  const input = ctx.input as {
    regionId?: string;
    currencyCode?: string;
    email?: string;
  };
  const body: Record<string, unknown> = {};
  if (input.regionId) body.region_id = input.regionId;
  if (input.currencyCode) body.currency_code = input.currencyCode;
  if (input.email) body.email = input.email;

  const data = await fetcher<Record<string, unknown>>("/store/carts", {
    method: "POST",
    body,
  });
  return { success: true, data };
});

export const addToCart = withMedusa(async (fetcher, ctx) => {
  const { cartId, variantId, quantity } = ctx.input as {
    cartId: string;
    variantId: string;
    quantity: number;
  };
  const data = await fetcher<Record<string, unknown>>(
    `/store/carts/${cartId}/line-items`,
    {
      method: "POST",
      body: { variant_id: variantId, quantity },
    },
  );
  return { success: true, data };
});

export const getCart = withMedusa(async (fetcher, ctx) => {
  const { cartId } = ctx.input as { cartId: string };
  const data = await fetcher<Record<string, unknown>>(`/store/carts/${cartId}`);
  return { success: true, data };
});

export const setDeliveryAddress = withMedusa(async (fetcher, ctx) => {
  const { cartId, address } = ctx.input as {
    cartId: string;
    address: {
      firstName: string;
      lastName: string;
      address1: string;
      address2?: string;
      city: string;
      postalCode: string;
      countryCode: string;
      phone?: string;
    };
  };
  const data = await fetcher<Record<string, unknown>>(
    `/store/carts/${cartId}`,
    {
      method: "POST",
      body: {
        shipping_address: {
          first_name: address.firstName,
          last_name: address.lastName,
          address_1: address.address1,
          address_2: address.address2 ?? "",
          city: address.city,
          postal_code: address.postalCode,
          country_code: address.countryCode,
          phone: address.phone ?? "",
        },
      },
    },
  );
  return { success: true, data };
});

// Auto-initiates a payment session before completing the cart.
// Medusa v2 requires a payment session on the cart's payment collection, but
// in agent-driven flows there is no checkout UI for the customer to pick a
// payment method. We resolve the first available provider for the cart's region
// and create the session automatically. See ADR-003 for rationale and future
// extension options (explicit provider selection, payment links).
export const completeCart = withMedusa(async (fetcher, ctx) => {
  const { cartId } = ctx.input as { cartId: string };

  // Step 1: Fetch cart to get payment_collection id and region
  const cartData = await fetcher<{
    cart: {
      payment_collection?: { id: string };
      region_id?: string;
      region?: { id: string };
    };
  }>(`/store/carts/${cartId}`);

  const paymentCollectionId = cartData.cart?.payment_collection?.id;
  if (!paymentCollectionId) {
    return {
      success: false,
      error:
        "Cart has no payment collection. Add items and a shipping address first.",
    };
  }

  const regionId = cartData.cart?.region_id ?? cartData.cart?.region?.id;
  if (!regionId) {
    return {
      success: false,
      error:
        "Cart has no region. Cannot determine available payment providers.",
    };
  }

  // Step 2: Look up available payment providers for the cart's region
  const { payment_providers } = await fetcher<{
    payment_providers: { id: string }[];
  }>("/store/payment-providers", { params: { region_id: regionId } });

  const providerId = payment_providers?.[0]?.id;
  if (!providerId) {
    return {
      success: false,
      error: "No payment providers available for this region.",
    };
  }

  // Step 3: Initialize payment session with the first available provider
  await fetcher<Record<string, unknown>>(
    `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
    { method: "POST", body: { provider_id: providerId } },
  );

  // Step 4: Complete the cart
  const data = await fetcher<Record<string, unknown>>(
    `/store/carts/${cartId}/complete`,
    { method: "POST" },
  );
  return { success: true, data };
});

export const getOrder = withMedusa(async (fetcher, ctx) => {
  const { orderId } = ctx.input as { orderId: string };
  const data = await fetcher<Record<string, unknown>>(
    `/store/orders/${orderId}`,
  );
  const baseUrl = ctx.config.baseUrl?.replace(/\/$/, "");
  return {
    success: true,
    data,
    ...(baseUrl && {
      url: `${baseUrl}/app/orders/${orderId}`,
    }),
  };
});

// ---------------------------------------------------------------------------
// Admin API handlers
// ---------------------------------------------------------------------------

const withMedusaAdmin = withConnector(createMedusaAdminFetcher);

/** Medusa Admin API response types for order detail. */
interface MedusaOrderItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
}

interface MedusaOrderDetail {
  id: string;
  display_id: number;
  status: string;
  total: number;
  currency_code: string;
  summary: Record<string, unknown>;
  version: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  items: MedusaOrderItem[];
  [key: string]: unknown;
}

export const lookUpOrder = withMedusaAdmin(async (fetcher, ctx) => {
  const { email, displayId } = ctx.input as {
    email: string;
    displayId: number;
  };

  // Step 1: Find customer by email
  const { customers } = await fetcher<{
    customers: { id: string }[];
  }>("/admin/customers", { params: { email } });

  if (!customers?.length) {
    return { success: false, error: "No customer found with this email" };
  }

  // Step 2: Paginate through orders looking for display_id match
  const customerId = customers[0].id;
  const PAGE_SIZE = 50;
  const MAX_PAGES = 20;
  let offset = 0;
  let page = 0;

  while (true) {
    if (page >= MAX_PAGES) {
      return {
        success: false,
        error: `Order #${displayId} not found within the first ${MAX_PAGES * PAGE_SIZE} orders for customer ${email}. Please narrow your search.`,
      };
    }
    const { orders, count } = await fetcher<{
      orders: MedusaOrderDetail[];
      count: number;
    }>("/admin/orders", {
      params: {
        customer_id: customerId,
        limit: PAGE_SIZE,
        offset,
        order: "-created_at",
        fields:
          "id,display_id,status,total,currency_code,summary,version,metadata,created_at,updated_at,*items",
      },
    });

    const match = orders?.find((o) => o.display_id === displayId);
    if (match) {
      const baseUrl = ctx.config.baseUrl?.replace(/\/$/, "");
      return {
        success: true,
        data: match,
        ...(baseUrl && {
          url: `${baseUrl}/app/orders/${match.id}`,
        }),
      };
    }

    offset += PAGE_SIZE;
    page++;
    if (offset >= count) {
      return {
        success: false,
        error: `Order #${displayId} not found for customer ${email}`,
      };
    }
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function healthCheck(
  config: Record<string, string>,
): Promise<HealthCheckResult> {
  return runHealthCheck(async () => {
    const fetcher = createMedusaFetcher(config, 5_000);
    await fetcher("/store/products", { params: { limit: "1" } });
  });
}
