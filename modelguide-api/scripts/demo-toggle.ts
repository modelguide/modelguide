/**
 * Toggle demo_enabled flag on an organization.
 * Usage: bun run scripts/demo-toggle.ts <enable|disable> <org-slug>
 */

import { db } from "@db/client";
import { organizations } from "@db/schema";
import { eq } from "drizzle-orm";

const [action, slug] = process.argv.slice(2);

if (!action || !slug || !["enable", "disable"].includes(action)) {
  console.error(
    "Usage: bun run scripts/demo-toggle.ts <enable|disable> <org-slug>",
  );
  process.exit(1);
}

const enabled = action === "enable";

const updated = await db
  .update(organizations)
  .set({ demoEnabled: enabled })
  .where(eq(organizations.slug, slug))
  .returning({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
  });

if (updated.length === 0) {
  console.error(`Organization with slug "${slug}" not found.`);
  process.exit(1);
}

console.log(
  `Demo mode ${enabled ? "enabled" : "disabled"} for "${updated[0].name}" (${updated[0].slug})`,
);
process.exit(0);
