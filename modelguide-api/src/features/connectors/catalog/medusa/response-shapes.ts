/**
 * Response shape trimming for Medusa API responses.
 *
 * Medusa returns ~1,500 lines of JSON per order with noise fields (raw_*,
 * tax breakdowns, fulfillment detail IDs) that cause LLMs to confuse details
 * between records. These shapes define an allowlist of fields to keep.
 *
 * See: https://github.com/modelguide/modelguide/issues/148
 */

// ---------------------------------------------------------------------------
// Shape definition types
// ---------------------------------------------------------------------------

/** A shape is a recursive allowlist of keys to keep. `true` = keep as-is. */
type Shape = { [key: string]: true | Shape };

// ---------------------------------------------------------------------------
// Generic trimmer
// ---------------------------------------------------------------------------

/**
 * Recursively trim `obj` to only the keys present in `shape`.
 * - `true` in the shape means keep the value as-is.
 * - A nested shape object means recurse into that key.
 * - If the value is an array, each element is trimmed with the nested shape.
 * - Missing keys in the source are silently skipped.
 */
export function trimToShape<T extends Record<string, unknown>>(
  obj: T | null | undefined,
  shape: Shape,
): Record<string, unknown> | null {
  if (obj == null) return null;

  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(shape)) {
    if (!(key in obj)) continue;
    const value = obj[key];

    if (spec === true) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item != null && typeof item === "object"
          ? trimToShape(item as Record<string, unknown>, spec)
          : item,
      );
    } else if (value != null && typeof value === "object") {
      result[key] = trimToShape(value as Record<string, unknown>, spec);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

const SHIPPING_ADDRESS_SHAPE: Shape = {
  first_name: true,
  last_name: true,
  address_1: true,
  address_2: true,
  city: true,
  postal_code: true,
  country_code: true,
  phone: true,
};

const ORDER_ITEM_SHAPE: Shape = {
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

const ORDER_SHAPE: Shape = {
  id: true,
  display_id: true,
  email: true,
  status: true,
  total: true,
  currency_code: true,
  created_at: true,
  fulfillment_status: true,
  payment_status: true,
  shipping_address: SHIPPING_ADDRESS_SHAPE,
  items: ORDER_ITEM_SHAPE,
};

const VARIANT_SHAPE: Shape = {
  id: true,
  title: true,
  sku: true,
  prices: true,
  inventory_quantity: true,
  options: true,
};

const PRODUCT_SHAPE: Shape = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  handle: true,
  status: true,
  thumbnail: true,
  images: true,
  variants: VARIANT_SHAPE,
  options: { id: true, title: true, values: true },
};

const CART_ITEM_SHAPE: Shape = {
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

const CART_SHAPE: Shape = {
  id: true,
  email: true,
  total: true,
  subtotal: true,
  discount_total: true,
  shipping_total: true,
  tax_total: true,
  currency_code: true,
  items: CART_ITEM_SHAPE,
  shipping_address: SHIPPING_ADDRESS_SHAPE,
  shipping_methods: true,
};

const RETURN_SHAPE: Shape = {
  id: true,
  order_id: true,
  status: true,
  refund_amount: true,
  created_at: true,
  items: {
    id: true,
    quantity: true,
    reason_id: true,
    note: true,
    item_id: true,
  },
};

// ---------------------------------------------------------------------------
// Convenience trimmers
// ---------------------------------------------------------------------------

export function trimOrder(
  order: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return trimToShape(order, ORDER_SHAPE);
}

export function trimProduct(
  product: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return trimToShape(product, PRODUCT_SHAPE);
}

export function trimProducts(
  products: Record<string, unknown>[] | null | undefined,
): Record<string, unknown>[] {
  if (!products) return [];
  return products
    .map((p) => trimToShape(p, PRODUCT_SHAPE))
    .filter((p): p is Record<string, unknown> => p != null);
}

export function trimCart(
  cart: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return trimToShape(cart, CART_SHAPE);
}

export function trimReturn(
  ret: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return trimToShape(ret, RETURN_SHAPE);
}
