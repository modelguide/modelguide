/**
 * Shared utilities for extracting external resource links from tool call outputs.
 * Used by both the MCP addMessages path and the ElevenLabs post-call webhook.
 */

export interface ExtractedLink {
  url: string;
  title: string | null;
  connectorSlug: string | null;
  resourceType: string | null;
}

interface ToolOutputWithUrl {
  url?: unknown;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Extract external links from a list of tool call outputs.
 */
export function extractLinks(
  toolCalls: { toolName: string; toolOutput: ToolOutputWithUrl | null }[],
): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const tc of toolCalls) {
    if (!tc.toolOutput) continue;

    const url = tc.toolOutput.url;
    if (!url || typeof url !== "string" || seen.has(url)) continue;
    seen.add(url);

    const parts = tc.toolName.split("_");
    const connectorSlug = parts[0] || null;
    const resourceType = deriveResourceType(parts.slice(1));
    const title = deriveTitle(
      tc.toolOutput.data as Record<string, unknown> | undefined,
      resourceType,
    );

    links.push({ url, title, connectorSlug, resourceType });
  }

  return links;
}

/**
 * Derive resource type from the action parts of a tool name.
 * e.g. ["get", "ticket"] → "ticket", ["look", "up", "order"] → "order"
 */
function deriveResourceType(parts: string[]): string | null {
  const verbs = [
    "get",
    "create",
    "update",
    "add",
    "list",
    "search",
    "look",
    "up",
  ];
  const nouns = parts.filter((p) => !verbs.includes(p));
  return nouns[nouns.length - 1] ?? parts[parts.length - 1] ?? null;
}

/**
 * Derive a human-readable title from tool output data.
 */
function deriveTitle(
  data: Record<string, unknown> | undefined,
  resourceType: string | null,
): string | null {
  if (!data) return null;

  // Zendesk: { ticket: { id, subject } }, Medusa: { id, display_id }
  const nested = (data.ticket ?? data.order ?? data) as Record<string, unknown>;
  const subject = nested.subject as string | undefined;
  const displayId = nested.display_id as number | undefined;
  const id = nested.id as string | number | undefined;

  if (subject && id) return `${subject} (#${id})`;
  if (displayId) {
    const label =
      resourceType === "order" ? "Order" : (resourceType ?? "Resource");
    return `${label} #${displayId}`;
  }
  if (subject) return subject;
  if (id) return `#${id}`;
  return null;
}
