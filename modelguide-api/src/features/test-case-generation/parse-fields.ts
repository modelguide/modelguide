/**
 * Shared field parser for LLM-generated key-value pairs.
 *
 * Both dimensions.ts and generate.ts use an array-of-entries format
 * ({ key, value } pairs with string values) to work around z.record()
 * limitations with some LLM providers. This utility converts those
 * string-encoded fields back to properly typed values.
 */

import type { ToolStateVariant } from "./types";

/**
 * Convert an array of { key, value } string pairs into a ToolStateVariant record.
 *
 * Parses "true"/"false" → booleans, numeric strings → numbers,
 * and leaves everything else as strings.
 */
export function parseFields(
  fields: { key: string; value: string }[],
): ToolStateVariant {
  const record: ToolStateVariant = {};
  for (const field of fields) {
    if (field.value === "true") record[field.key] = true;
    else if (field.value === "false") record[field.key] = false;
    else if (field.value !== "" && !Number.isNaN(Number(field.value)))
      record[field.key] = Number(field.value);
    else record[field.key] = field.value;
  }
  return record;
}
