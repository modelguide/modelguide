/**
 * Simulation personas table — org-scoped persona definitions for eval simulations.
 *
 * Built-in personas (polite-buyer, etc.) remain hardcoded in personas.ts.
 * This table stores org-specific custom personas imported via `mg import-personas`.
 * DB personas take precedence over built-ins when IDs conflict.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./core";

export const simulationPersonas = pgTable(
  "simulation_personas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Slug identifier used in test case YAML (e.g. "bank-nowa-customer"). */
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt").notNull(),
    traits: text("traits").array().default([]),
    maxTurns: integer("max_turns"),
    /** Email used as customer identifier in simulation sessions. */
    email: varchar("email", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    unique("simulation_personas_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("simulation_personas_org_idx").on(table.organizationId),
  ],
).enableRLS();
