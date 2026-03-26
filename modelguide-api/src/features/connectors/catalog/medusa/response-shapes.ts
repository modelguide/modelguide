/**
 * Medusa response shapes — allowlists of fields to keep per entity.
 *
 * These are referenced by `responseShape` in each tool definition.
 * After a handler returns, `executeTool()` applies `trimToShape()`
 * using the declared shape — no per-handler trim logic needed.
 *
 * See: https://github.com/modelguide/modelguide/issues/148
 */

import type { ResponseShape } from "../lib/response-trimmer";

// ---------------------------------------------------------------------------
// Shared sub-shapes
// ---------------------------------------------------------------------------

const SHIPPING_ADDRESS: ResponseShape = {
  first_name: true,
  last_name: true,
  address_1: true,
  address_2: true,
  city: true,
  postal_code: true,
  country_code: true,
  phone: true,
};

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

const ORDER_ITEM: ResponseShape = {
  id: true,
  title: true,
  subtitle: true,
  quantity: true,
  unit_price: true,
  total: true,
  subtotal: true,
  product_id: true,
  variant_id: true,
  variant_sku: true,
  product_title: true,
  variant_title: true,
  product_description: true,
  thumbnail: true,
  discount_total: true,
  discount_subtotal: true,
  original_total: true,
  original_subtotal: true,
  shipped_quantity: true,
  delivered_quantity: true,
  fulfilled_quantity: true,
  return_requested_quantity: true,
  return_received_quantity: true,
  return_dismissed_quantity: true,
  written_off_quantity: true,
  variant: { id: true, title: true },
};

export const ORDER: ResponseShape = {
  id: true,
  display_id: true,
  email: true,
  status: true,
  total: true,
  currency_code: true,
  created_at: true,
  fulfillment_status: true,
  payment_status: true,
  shipping_address: SHIPPING_ADDRESS,
  items: ORDER_ITEM,
};

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

const VARIANT: ResponseShape = {
  id: true,
  title: true,
  sku: true,
  prices: true,
  inventory_quantity: true,
  options: true,
};

export const PRODUCT: ResponseShape = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  handle: true,
  status: true,
  thumbnail: true,
  images: true,
  metadata: true,
  variants: VARIANT,
  options: { id: true, title: true, values: true },
};

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

const CART_ITEM: ResponseShape = {
  id: true,
  title: true,
  subtitle: true,
  quantity: true,
  unit_price: true,
  total: true,
  subtotal: true,
  variant_id: true,
  product_id: true,
  product_title: true,
  variant_title: true,
  thumbnail: true,
  variant: { id: true, title: true },
};

export const CART: ResponseShape = {
  id: true,
  email: true,
  total: true,
  subtotal: true,
  discount_total: true,
  shipping_total: true,
  tax_total: true,
  currency_code: true,
  items: CART_ITEM,
  shipping_address: SHIPPING_ADDRESS,
  shipping_methods: true,
};
