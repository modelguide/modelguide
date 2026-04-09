/**
 * Eval configs table — reusable evaluator definitions shared across SOPs and guardrails.
 */

import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations } from "./core";
import { users } from "./core";
import { evaluatorTypeEnum } from "./enums";

export const evalConfigs = pgTable(
  "eval_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    evaluatorType: evaluatorTypeEnum("evaluator_type").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    tags: text("tags").array().default([]),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index("eval_configs_org_idx").on(table.organizationId),
    index("eval_configs_evaluator_type_idx").on(table.evaluatorType),
  ],
).enableRLS();

export const evalConfigsRelations = relations(evalConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [evalConfigs.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [evalConfigs.createdBy],
    references: [users.id],
  }),
}));
