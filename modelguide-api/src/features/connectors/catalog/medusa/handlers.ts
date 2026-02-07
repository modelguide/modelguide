/**
 * Medusa v2 Store API tool handlers.
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import {
  MedusaApiError,
  type MedusaFetcher,
  createMedusaFetcher,
} from "./client";

function errorResult(err: unknown): ToolExecutionResult {
  if (err instanceof MedusaApiError) {
    return { success: false, error: `Medusa API ${err.status}: ${err.body}` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}

/**
 * Wraps a handler body so every handler gets a fetcher and
 * consistent error handling without repeating try/catch.
 */
function withMedusa(
  fn: (
    fetcher: MedusaFetcher,
    ctx: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>,
): (ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async function handler(ctx) {
    try {
      const fetcher = createMedusaFetcher(ctx.config);
      return await fn(fetcher, ctx);
    } catch (err) {
      return errorResult(err);
    }
  };
}

export const listProducts = withMedusa(async (fetcher, ctx) => {
  const input = ctx.input as {
    limit?: number;
    offset?: number;
    q?: string;
  };
  const data = await fetcher<Record<string, unknown>>("/store/products", {
    params: {
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
      q: input.q,
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
