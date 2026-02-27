/** Derive tool slug from catalog tool name. */
export function toolSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_");
}
