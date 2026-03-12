/**
 * Allowlist-based response trimmer for connector tool outputs.
 *
 * Connectors can declare a `responseShape` on each tool definition.
 * After the handler returns, `executeTool()` applies `trimToShape()`
 * to strip noise fields automatically — no per-handler trim logic needed.
 */

/** A shape is a recursive allowlist of keys to keep. `true` = keep as-is. */
export type ResponseShape = { [key: string]: true | ResponseShape };

/**
 * Recursively trim `obj` to only the keys present in `shape`.
 * - `true` keeps the value as-is (including nested objects/arrays).
 * - A nested shape recurses into objects or maps over arrays.
 * - Missing keys in the source are silently skipped.
 */
export function trimToShape(
  obj: Record<string, unknown> | null | undefined,
  shape: ResponseShape,
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
