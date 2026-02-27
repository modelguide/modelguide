/**
 * Medusa v2 tool handlers (Store + Admin API).
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import { type ConnectorFetcher, withConnector } from "../lib/http-client";
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

// Auto-selects a shipping method and initiates a payment session before
// completing the cart. Medusa v2 requires both a shipping method and a payment
// session on the cart's payment collection, but in agent-driven flows there is
// no checkout UI for the customer to pick these. We resolve the cheapest
// shipping option and the first available payment provider automatically.
// See ADR-003 for rationale and future extension options.
export const completeCart = withMedusa(async (fetcher, ctx) => {
  const { cartId } = ctx.input as { cartId: string };

  // Step 1: Fetch cart to check current state
  let cartData = await fetcher<{
    cart: {
      shipping_methods?: { id: string }[];
      payment_collection?: { id: string };
      region_id?: string;
      region?: { id: string };
    };
  }>(`/store/carts/${cartId}`);

  // Step 2: Auto-select shipping method if none is set
  if (!cartData.cart?.shipping_methods?.length) {
    const { shipping_options } = await fetcher<{
      shipping_options: { id: string; amount: number; name: string }[];
    }>("/store/shipping-options", { params: { cart_id: cartId } });

    const options = shipping_options ?? [];
    if (!options.length) {
      return {
        success: false,
        error:
          "No shipping options available for this cart. Check that the store has fulfillment configured for the delivery address region.",
      };
    }

    // Pick the cheapest option
    const cheapest = options.reduce((min, opt) =>
      opt.amount < min.amount ? opt : min,
    );

    await fetcher<Record<string, unknown>>(
      `/store/carts/${cartId}/shipping-methods`,
      { method: "POST", body: { option_id: cheapest.id } },
    );

    // Re-fetch cart after adding shipping method
    cartData = await fetcher<typeof cartData>(`/store/carts/${cartId}`);
  }

  // Step 3: Verify region exists (needed for payment provider lookup)
  const regionId = cartData.cart?.region_id ?? cartData.cart?.region?.id;
  if (!regionId) {
    return {
      success: false,
      error:
        "Cart has no region. Cannot determine available payment providers.",
    };
  }

  // Step 4: Ensure payment collection exists (Medusa v2 requires explicit creation)
  let paymentCollectionId = cartData.cart?.payment_collection?.id;
  if (!paymentCollectionId) {
    const { payment_collection } = await fetcher<{
      payment_collection: { id: string };
    }>("/store/payment-collections", {
      method: "POST",
      body: { cart_id: cartId },
    });
    paymentCollectionId = payment_collection?.id;
  }

  if (!paymentCollectionId) {
    return {
      success: false,
      error: "Could not initialize payment collection for this cart.",
    };
  }

  // Step 5: Look up available payment providers for the cart's region
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

  // Step 6: Initialize payment session with the first available provider
  await fetcher<Record<string, unknown>>(
    `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
    { method: "POST", body: { provider_id: providerId } },
  );

  // Step 7: Complete the cart
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
  const url = dashboardUrl(ctx.config, `/app/orders/${orderId}`);
  return {
    success: true,
    data,
    ...(url && { url }),
  };
});

// ---------------------------------------------------------------------------
// Admin API handlers
// ---------------------------------------------------------------------------

const withMedusaAdmin = withConnector(createMedusaAdminFetcher);

/** Resolve a Medusa customer ID from an email address via the Admin API. */
async function resolveCustomerByEmail(
  fetcher: ConnectorFetcher,
  email: string,
): Promise<{ customerId: string } | { error: string }> {
  const { customers } = await fetcher<{ customers: { id: string }[] }>(
    "/admin/customers",
    { params: { email } },
  );
  if (!customers?.length) return { error: "No customer found with this email" };
  return { customerId: customers[0].id };
}

/** Build a Medusa dashboard URL if baseUrl is configured. */
function dashboardUrl(
  config: Record<string, string>,
  path: string,
): string | undefined {
  const base = config.baseUrl?.replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
}

/** Medusa Admin API response types for order detail. */
interface MedusaOrderItemVariant {
  id: string;
  title: string;
}

interface MedusaOrderItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  variant?: MedusaOrderItemVariant;
}

interface MedusaOrderDetail {
  id: string;
  display_id: number;
  status: string;
  total: number;
  currency_code: string;
  email: string;
  summary: Record<string, unknown>;
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
  const resolved = await resolveCustomerByEmail(fetcher, email);
  if ("error" in resolved) {
    return { success: false, error: resolved.error };
  }

  // Step 2: Paginate through orders looking for display_id match
  const customerId = resolved.customerId;
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
          "id,display_id,status,total,currency_code,email,summary,metadata,created_at,updated_at,*items,*items.variant,*shipping_address",
      },
    });

    const match = orders?.find((o) => o.display_id === displayId);
    if (match) {
      const url = dashboardUrl(ctx.config, `/app/orders/${match.id}`);
      return {
        success: true,
        data: match,
        ...(url && { url }),
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

export const lookUpOrderHistory = withMedusaAdmin(async (fetcher, ctx) => {
  const input = ctx.input as {
    customerId?: string;
    email?: string;
    limit?: number;
    offset?: number;
  };

  // Resolve customer ID — either provided directly or looked up by email
  let customerId = input.customerId;
  if (!customerId) {
    if (!input.email) {
      return {
        success: false,
        error: "Either customerId or email is required",
      };
    }
    const resolved = await resolveCustomerByEmail(fetcher, input.email);
    if ("error" in resolved) {
      return { success: false, error: resolved.error };
    }
    customerId = resolved.customerId;
  }

  const limit = Math.min(input.limit ?? 5, 50);
  const offset = input.offset ?? 0;

  const { orders, count } = await fetcher<{
    orders: MedusaOrderDetail[];
    count: number;
  }>("/admin/orders", {
    params: {
      customer_id: customerId,
      limit,
      offset,
      order: "-created_at",
      fields:
        "id,display_id,status,total,currency_code,email,metadata,created_at,updated_at,*items,*items.variant,*shipping_address,*summary",
    },
  });

  if (!orders?.length) {
    const message =
      offset > 0
        ? `No more orders — showing ${offset} of ${count} total`
        : "No orders found for this customer";
    return { success: false, error: message };
  }

  const url = dashboardUrl(ctx.config, "/app/orders");
  return {
    success: true,
    data: { orders, count, limit, offset },
    ...(url && { url }),
  };
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
