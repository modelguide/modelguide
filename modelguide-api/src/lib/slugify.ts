/** Derive tool slug from catalog tool name. */
export function toolSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_");
}

/** Convert a name to a URL-safe slug (kebab-case). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
