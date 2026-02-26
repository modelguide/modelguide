/**
 * Deterministic JSON stringify with sorted keys at every depth.
 * Prevents false-positive comparisons when Postgres JSONB reorders object keys.
 *
 * Returns undefined for null/undefined input (not a valid JSONB value).
 */
export function stableStringify(obj: unknown): string | undefined {
  if (obj === null || obj === undefined) return undefined;
  return stringify(obj);
}

function stringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => stringify(item)).join(",")}]`;
  }
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stringify((obj as Record<string, unknown>)[key])}`,
      );
    return `{${sorted.join(",")}}`;
  }
  return JSON.stringify(obj);
}
