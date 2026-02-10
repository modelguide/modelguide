/**
 * Medusa v2 tool handlers (Store + Admin API).
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import { withConnector } from "../lib/http-client";
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
  };
  const body: Record<string, unknown> = {};
  if (input.regionId) body.region_id = input.regionId;
  if (input.currencyCode) body.currency_code = input.currencyCode;

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

export const completeCart = withMedusa(async (fetcher, ctx) => {
  const { cartId } = ctx.input as { cartId: string };
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
  return { success: true, data };
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
  variant?: {
    id: string;
    title: string;
    sku: string | null;
    product?: {
      id: string;
      title: string;
    };
  };
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
      orders: { id: string; display_id: number }[];
      count: number;
    }>("/admin/orders", {
      params: {
        customer_id: customerId,
        limit: PAGE_SIZE,
        offset,
        order: "-created_at",
      },
    });

    const match = orders?.find((o) => o.display_id === displayId);
    if (match) {
      // Step 3: Fetch full order with items
      const { order } = await fetcher<{ order: MedusaOrderDetail }>(
        `/admin/orders/${match.id}`,
        {
          params: {
            fields:
              "id,display_id,status,total,currency_code,summary,version,metadata,created_at,updated_at,*items,*items.variant,*items.variant.product",
          },
        },
      );
      return { success: true, data: order };
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
