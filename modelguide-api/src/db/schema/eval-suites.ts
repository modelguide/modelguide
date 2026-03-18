/**
 * Eval suites tables — test harness for SOP-based evaluation.
 *
 * Tables:
 *  - eval_suites:             suite metadata (agent + SOP pair)
 *  - eval_suite_test_cases:   individual test cases per suite
 *  - eval_suite_evaluators:   evaluators per test case (FK to eval_configs)
 *  - eval_suite_runs:         thin aggregator for a full suite execution
 *
 * All tables have organization_id + RLS enabled.
 * Evaluators FK to eval_configs with NO ACTION (no cascade).
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { agents, organizations, sops, users } from "./core";
import {
  evalSuiteRunStatusEnum,
  evalSuiteStatusEnum,
  evalSuiteTestCaseSourceEnum,
} from "./enums";
import { evalConfigs } from "./eval-configs";

// ============================================================================
// Eval Suites
// ============================================================================

export const evalSuites = pgTable(
  "eval_suites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sopId: uuid("sop_id").references(() => sops.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: evalSuiteStatusEnum("status").notNull().default("active"),
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
    // Unique per (agent, sop) when sop is set; multiple sop-less suites allowed per agent
    index("eval_suites_agent_sop_idx").on(table.agentId, table.sopId),
    index("eval_suites_org_idx").on(table.organizationId),
    index("eval_suites_agent_idx").on(table.agentId),
    index("eval_suites_sop_idx").on(table.sopId),
  ],
).enableRLS();

export const evalSuitesRelations = relations(evalSuites, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [evalSuites.organizationId],
    references: [organizations.id],
  }),
  agent: one(agents, {
    fields: [evalSuites.agentId],
    references: [agents.id],
  }),
  sop: one(sops, {
    fields: [evalSuites.sopId],
    references: [sops.id],
  }),
  creator: one(users, {
    fields: [evalSuites.createdBy],
    references: [users.id],
  }),
  testCases: many(evalSuiteTestCases),
  runs: many(evalSuiteRuns),
}));

// ============================================================================
// Eval Suite Test Cases
// ============================================================================

export const evalSuiteTestCases = pgTable(
  "eval_suite_test_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 100 }),
    /** Whether this test case was auto-generated or manually created. */
    source: evalSuiteTestCaseSourceEnum("source").notNull().default("auto"),
    /** Input scenario for the test (e.g., customer message). */
    input: jsonb("input").$type<Record<string, unknown>>(),
    /** Expected behavior description. */
    expectedBehavior: text("expected_behavior"),
    /** Mock tool responses for deterministic testing (Phase 3 — simulation runner). */
    mockToolResponses: jsonb("mock_tool_responses")
      .$type<Record<string, unknown>>()
      .default({}),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index("eval_suite_test_cases_suite_idx").on(table.suiteId),
    index("eval_suite_test_cases_org_idx").on(table.organizationId),
  ],
).enableRLS();

export const evalSuiteTestCasesRelations = relations(
  evalSuiteTestCases,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [evalSuiteTestCases.organizationId],
      references: [organizations.id],
    }),
    suite: one(evalSuites, {
      fields: [evalSuiteTestCases.suiteId],
      references: [evalSuites.id],
    }),
    evaluators: many(evalSuiteEvaluators),
  }),
);

// ============================================================================
// Eval Suite Evaluators (per test case, FK to eval_configs — NO CASCADE)
// ============================================================================

export const evalSuiteEvaluators = pgTable(
  "eval_suite_evaluators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    testCaseId: uuid("test_case_id")
      .notNull()
      .references(() => evalSuiteTestCases.id, { onDelete: "cascade" }),
    evalConfigId: uuid("eval_config_id")
      .notNull()
      .references(() => evalConfigs.id), // NO ACTION — no cascade
    name: varchar("name", { length: 255 }).notNull(),
    sopStepId: varchar("sop_step_id", { length: 100 }),
    source: evalSuiteTestCaseSourceEnum("source").notNull().default("auto"),
    order: integer("order").notNull().default(0),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("eval_suite_evaluators_test_case_idx").on(table.testCaseId),
    index("eval_suite_evaluators_config_idx").on(table.evalConfigId),
    index("eval_suite_evaluators_org_idx").on(table.organizationId),
  ],
).enableRLS();

export const evalSuiteEvaluatorsRelations = relations(
  evalSuiteEvaluators,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [evalSuiteEvaluators.organizationId],
      references: [organizations.id],
    }),
    testCase: one(evalSuiteTestCases, {
      fields: [evalSuiteEvaluators.testCaseId],
      references: [evalSuiteTestCases.id],
    }),
    evalConfig: one(evalConfigs, {
      fields: [evalSuiteEvaluators.evalConfigId],
      references: [evalConfigs.id],
    }),
  }),
);

// ============================================================================
// Eval Suite Runs — thin aggregator, no cached counters
// ============================================================================

export const evalSuiteRuns = pgTable(
  "eval_suite_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    suiteId: uuid("suite_id")
      .notNull()
      .references(() => evalSuites.id, { onDelete: "cascade" }),
    status: evalSuiteRunStatusEnum("status").notNull().default("running"),
    /** Prompt source strategy used for this run. */
    promptSource: varchar("prompt_source", { length: 50 }).notNull(),
    triggeredBy: uuid("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("eval_suite_runs_suite_idx").on(table.suiteId),
    index("eval_suite_runs_org_idx").on(table.organizationId),
  ],
).enableRLS();

export const evalSuiteRunsRelations = relations(evalSuiteRuns, ({ one }) => ({
  organization: one(organizations, {
    fields: [evalSuiteRuns.organizationId],
    references: [organizations.id],
  }),
  suite: one(evalSuites, {
    fields: [evalSuiteRuns.suiteId],
    references: [evalSuites.id],
  }),
  triggeredByUser: one(users, {
    fields: [evalSuiteRuns.triggeredBy],
    references: [users.id],
  }),
}));
