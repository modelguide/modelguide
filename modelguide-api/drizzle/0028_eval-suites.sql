-- Eval Suites Infrastructure (Phase 2)
-- Tables: eval_suites, eval_suite_test_cases, eval_suite_evaluators, eval_suite_runs
-- All tables have organization_id + RLS enabled.
-- Evaluators FK to eval_configs with NO ACTION (no cascade).
-- eval_runs gains suite_run_id + test_case_id columns for suite linkage.

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "eval_suite_status" AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "eval_suite_test_case_source" AS ENUM ('auto', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "eval_suite_run_status" AS ENUM ('running', 'completed', 'completed_with_errors', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Add new values to eval_source_type enum (existing enum from eval_runs)
ALTER TYPE "eval_source_type" ADD VALUE IF NOT EXISTS 'suite';
ALTER TYPE "eval_source_type" ADD VALUE IF NOT EXISTS 'replay_test';
ALTER TYPE "eval_source_type" ADD VALUE IF NOT EXISTS 'live';

-- ============================================================================
-- Eval Suites
-- ============================================================================

CREATE TABLE IF NOT EXISTS "eval_suites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "sop_id" uuid REFERENCES "sops"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "status" eval_suite_status NOT NULL DEFAULT 'active',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

ALTER TABLE "eval_suites" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "eval_suites_agent_sop_idx" ON "eval_suites" ("agent_id", "sop_id");
CREATE INDEX IF NOT EXISTS "eval_suites_org_idx" ON "eval_suites" ("organization_id");
CREATE INDEX IF NOT EXISTS "eval_suites_agent_idx" ON "eval_suites" ("agent_id");
CREATE INDEX IF NOT EXISTS "eval_suites_sop_idx" ON "eval_suites" ("sop_id");

-- RLS policies
CREATE POLICY "eval_suites_org_isolation" ON "eval_suites"
  USING ("organization_id" = current_setting('app.organization_id')::uuid);
CREATE POLICY "eval_suites_org_insert" ON "eval_suites"
  FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);

-- ============================================================================
-- Eval Suite Test Cases
-- ============================================================================

CREATE TABLE IF NOT EXISTS "eval_suite_test_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "suite_id" uuid NOT NULL REFERENCES "eval_suites"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "category" varchar(100),
  "source" eval_suite_test_case_source NOT NULL DEFAULT 'auto',
  "input" jsonb,
  "expected_behavior" text,
  "mock_tool_responses" jsonb DEFAULT '{}'::jsonb,
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);

ALTER TABLE "eval_suite_test_cases" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "eval_suite_test_cases_suite_idx" ON "eval_suite_test_cases" ("suite_id");
CREATE INDEX IF NOT EXISTS "eval_suite_test_cases_org_idx" ON "eval_suite_test_cases" ("organization_id");

-- RLS policies
CREATE POLICY "eval_suite_test_cases_org_isolation" ON "eval_suite_test_cases"
  USING ("organization_id" = current_setting('app.organization_id')::uuid);
CREATE POLICY "eval_suite_test_cases_org_insert" ON "eval_suite_test_cases"
  FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);

-- ============================================================================
-- Eval Suite Evaluators (FK to test_case_id, NOT suite_id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "eval_suite_evaluators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "test_case_id" uuid NOT NULL REFERENCES "eval_suite_test_cases"("id") ON DELETE CASCADE,
  "eval_config_id" uuid NOT NULL REFERENCES "eval_configs"("id") ON DELETE NO ACTION,
  "name" varchar(255) NOT NULL,
  "sop_step_id" varchar(100),
  "source" eval_suite_test_case_source NOT NULL DEFAULT 'auto',
  "order" integer NOT NULL DEFAULT 0,
  "required" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "eval_suite_evaluators" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "eval_suite_evaluators_test_case_idx" ON "eval_suite_evaluators" ("test_case_id");
CREATE INDEX IF NOT EXISTS "eval_suite_evaluators_config_idx" ON "eval_suite_evaluators" ("eval_config_id");
CREATE INDEX IF NOT EXISTS "eval_suite_evaluators_org_idx" ON "eval_suite_evaluators" ("organization_id");

-- RLS policies
CREATE POLICY "eval_suite_evaluators_org_isolation" ON "eval_suite_evaluators"
  USING ("organization_id" = current_setting('app.organization_id')::uuid);
CREATE POLICY "eval_suite_evaluators_org_insert" ON "eval_suite_evaluators"
  FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);

-- ============================================================================
-- Eval Suite Runs (thin aggregator — no cached `passed` column)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "eval_suite_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "suite_id" uuid NOT NULL REFERENCES "eval_suites"("id") ON DELETE CASCADE,
  "status" eval_suite_run_status NOT NULL DEFAULT 'running',
  "prompt_source" varchar(50) NOT NULL,
  "triggered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "duration_ms" integer,
  "metadata" jsonb
);

ALTER TABLE "eval_suite_runs" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "eval_suite_runs_suite_idx" ON "eval_suite_runs" ("suite_id");
CREATE INDEX IF NOT EXISTS "eval_suite_runs_org_idx" ON "eval_suite_runs" ("organization_id");

-- RLS policies
CREATE POLICY "eval_suite_runs_org_isolation" ON "eval_suite_runs"
  USING ("organization_id" = current_setting('app.organization_id')::uuid);
CREATE POLICY "eval_suite_runs_org_insert" ON "eval_suite_runs"
  FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);

-- ============================================================================
-- Extend eval_runs with suite linkage columns
-- ============================================================================

ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "suite_run_id" uuid REFERENCES "eval_suite_runs"("id") ON DELETE SET NULL;
ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "test_case_id" uuid REFERENCES "eval_suite_test_cases"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "eval_runs_suite_run_idx" ON "eval_runs" ("suite_run_id");

-- ============================================================================
-- Agents compiled columns (SOP-to-Agent compiler)
-- ============================================================================

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "compiled_instructions" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "compiled_at" timestamp with time zone;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "compiled_from" jsonb;
