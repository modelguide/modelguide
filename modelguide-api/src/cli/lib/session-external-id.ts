/**
 * Build a stable external ID for imported sessions.
 *
 * Explicit IDs win. Otherwise we derive a deterministic fingerprint from the
 * YAML payload so re-importing the same session entry is idempotent.
 */

import { createHash } from "node:crypto";
import type { SessionItemInput } from "../schemas/sessions.schema";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
    .join(",")}}`;
}

export function buildImportedSessionExternalId(item: SessionItemInput): string {
  if (item.externalId) {
    return item.externalId;
  }

  const fingerprint = createHash("sha256")
    .update(
      stableSerialize({
        agentSlug: item.agentSlug,
        channel: item.channel,
        status: item.status,
        userIdentifier: item.userIdentifier,
        hoursAgo: item.hoursAgo,
        messages: item.messages,
        feedback: item.feedback,
        links: item.links,
      }),
    )
    .digest("hex")
    .slice(0, 24);

  return `mg-import:${fingerprint}`;
}
