/**
 * Medusa v2 Store API tool handlers.
 * Each handler creates a fetcher from ctx.config and calls the appropriate endpoint.
 */

import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { MedusaApiError, createMedusaFetcher } from "./client";

function errorResult(err: unknown): ToolExecutionResult {
  if (err instanceof MedusaApiError) {
    return { success: false, error: `Medusa API ${err.status}: ${err.body}` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}

// 1. List Products
export async function listProducts(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const input = ctx.input as {
      limit?: number;
      offset?: number;
      q?: string;
    };
    const data = await fetch<Record<string, unknown>>("/store/products", {
      params: {
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
        q: input.q,
      },
    });
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 2. Get Product
export async function getProduct(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const { productId } = ctx.input as { productId: string };
    const data = await fetch<Record<string, unknown>>(
      `/store/products/${productId}`,
    );
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 3. Create Cart
export async function createCart(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const input = ctx.input as {
      regionId?: string;
      currencyCode?: string;
    };
    const body: Record<string, unknown> = {};
    if (input.regionId) body.region_id = input.regionId;
    if (input.currencyCode) body.currency_code = input.currencyCode;

    const data = await fetch<Record<string, unknown>>("/store/carts", {
      method: "POST",
      body,
    });
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 4. Add to Cart
export async function addToCart(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const { cartId, variantId, quantity } = ctx.input as {
      cartId: string;
      variantId: string;
      quantity: number;
    };
    const data = await fetch<Record<string, unknown>>(
      `/store/carts/${cartId}/line-items`,
      {
        method: "POST",
        body: { variant_id: variantId, quantity },
      },
    );
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 5. Get Cart
export async function getCart(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const { cartId } = ctx.input as { cartId: string };
    const data = await fetch<Record<string, unknown>>(`/store/carts/${cartId}`);
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 6. Set Delivery Address
export async function setDeliveryAddress(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
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
    const data = await fetch<Record<string, unknown>>(
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
  } catch (err) {
    return errorResult(err);
  }
}

// 7. Complete Cart
export async function completeCart(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const { cartId } = ctx.input as { cartId: string };
    const data = await fetch<Record<string, unknown>>(
      `/store/carts/${cartId}/complete`,
      { method: "POST" },
    );
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}

// 8. Get Order
export async function getOrder(
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const fetch = createMedusaFetcher(ctx.config);
    const { orderId } = ctx.input as { orderId: string };
    const data = await fetch<Record<string, unknown>>(
      `/store/orders/${orderId}`,
    );
    return { success: true, data };
  } catch (err) {
    return errorResult(err);
  }
}
