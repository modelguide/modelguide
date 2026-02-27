/**
 * Deterministic JSON stringify with sorted keys at every depth.
 * Prevents false-positive comparisons when Postgres JSONB reorders object keys.
 */
export function stableStringify(obj: unknown): string {
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(",")}]`;
  }
  if (obj !== null && typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((obj as Record<string, unknown>)[key])}`,
      );
    return `{${sorted.join(",")}}`;
  }
  return JSON.stringify(obj) ?? "null";
}
