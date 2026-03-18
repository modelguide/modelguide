/**
 * Eval runs + eval run scores tables — owned storage for evaluation results.
 *
 * Immutability: eval runs are audit records. No DELETE API route. See ADR-007.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { organizations, sessions } from "./core";
import { users } from "./core";
import {
  evalScoreResultEnum,
  evalSourceTypeEnum,
  evalStatusEnum,
  evaluatorTypeEnum,
} from "./enums";
import { evalConfigs } from "./eval-configs";
import { evalSuiteRuns, evalSuiteTestCases } from "./eval-suites";

// ============================================================================
// Eval Runs
// ============================================================================

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sourceType: evalSourceTypeEnum("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: evalStatusEnum("status").notNull().default("pending"),
    passed: boolean("passed"),
    durationMs: integer("duration_ms"),
    triggeredBy: uuid("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    externalRunId: varchar("external_run_id", { length: 255 }),
    externalRunUrl: varchar("external_run_url", { length: 500 }),
    /** Links this eval run to a suite run (null for standalone evals). */
    suiteRunId: uuid("suite_run_id").references(() => evalSuiteRuns.id, {
      onDelete: "set null",
    }),
    /** Test case this eval run belongs to (null for standalone evals). */
    testCaseId: uuid("test_case_id").references(() => evalSuiteTestCases.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // Prevent duplicate active evals for same session+source
    uniqueIndex("eval_runs_active_unique")
      .on(table.sessionId, table.sourceType, table.sourceId)
      .where(sql`status IN ('pending', 'running')`),
    index("eval_runs_session_idx").on(table.sessionId),
    index("eval_runs_source_idx").on(table.sourceType, table.sourceId),
    index("eval_runs_created_idx").on(table.createdAt),
    index("eval_runs_org_idx").on(table.organizationId),
    index("eval_runs_suite_run_idx").on(table.suiteRunId),
  ],
).enableRLS();

export const evalRunsRelations = relations(evalRuns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [evalRuns.organizationId],
    references: [organizations.id],
  }),
  session: one(sessions, {
    fields: [evalRuns.sessionId],
    references: [sessions.id],
  }),
  triggeredByUser: one(users, {
    fields: [evalRuns.triggeredBy],
    references: [users.id],
  }),
  scores: many(evalRunScores),
}));

// ============================================================================
// Eval Run Scores
// ============================================================================

export const evalRunScores = pgTable(
  "eval_run_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    evalConfigId: uuid("eval_config_id")
      .notNull()
      .references(() => evalConfigs.id),
    name: varchar("name", { length: 255 }).notNull(),
    scoreOrder: integer("score_order").notNull(),
    required: boolean("required").notNull(),
    evaluatorType: evaluatorTypeEnum("evaluator_type").notNull(),
    result: evalScoreResultEnum("result").notNull(),
    reasoning: text("reasoning").notNull(),
    failureClassification: varchar("failure_classification", { length: 50 }),
    expected: jsonb("expected").$type<Record<string, unknown>>(),
    actual: jsonb("actual").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("eval_run_scores_run_idx").on(table.evalRunId),
    index("eval_run_scores_config_idx").on(table.evalConfigId),
    index("eval_run_scores_org_idx").on(table.organizationId),
  ],
).enableRLS();

export const evalRunScoresRelations = relations(evalRunScores, ({ one }) => ({
  evalRun: one(evalRuns, {
    fields: [evalRunScores.evalRunId],
    references: [evalRuns.id],
  }),
  organization: one(organizations, {
    fields: [evalRunScores.organizationId],
    references: [organizations.id],
  }),
  evalConfig: one(evalConfigs, {
    fields: [evalRunScores.evalConfigId],
    references: [evalConfigs.id],
  }),
}));
