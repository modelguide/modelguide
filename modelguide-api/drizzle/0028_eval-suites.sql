CREATE TYPE "public"."eval_suite_run_status" AS ENUM('running', 'completed', 'completed_with_errors', 'failed');--> statement-breakpoint
CREATE TYPE "public"."eval_suite_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."eval_suite_test_case_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TABLE "eval_suite_evaluators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"eval_config_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sop_step_id" varchar(100),
	"source" "eval_suite_test_case_source" DEFAULT 'auto' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_suite_evaluators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "eval_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"status" "eval_suite_run_status" DEFAULT 'running' NOT NULL,
	"prompt_source" varchar(50) NOT NULL,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "eval_suite_test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"source" "eval_suite_test_case_source" DEFAULT 'auto' NOT NULL,
	"input" jsonb,
	"expected_behavior" text,
	"mock_tool_responses" jsonb DEFAULT '{}'::jsonb,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_suite_test_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"sop_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "eval_suite_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_suites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "compiled_instructions" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "compiled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "compiled_from" jsonb;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "test_case_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_suite_evaluators" ADD CONSTRAINT "eval_suite_evaluators_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_evaluators" ADD CONSTRAINT "eval_suite_evaluators_test_case_id_eval_suite_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."eval_suite_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_evaluators" ADD CONSTRAINT "eval_suite_evaluators_eval_config_id_eval_configs_id_fk" FOREIGN KEY ("eval_config_id") REFERENCES "public"."eval_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_test_cases" ADD CONSTRAINT "eval_suite_test_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_test_cases" ADD CONSTRAINT "eval_suite_test_cases_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_suite_evaluators_test_case_idx" ON "eval_suite_evaluators" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "eval_suite_evaluators_config_idx" ON "eval_suite_evaluators" USING btree ("eval_config_id");--> statement-breakpoint
CREATE INDEX "eval_suite_evaluators_org_idx" ON "eval_suite_evaluators" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_suite_idx" ON "eval_suite_runs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_org_idx" ON "eval_suite_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "eval_suite_test_cases_suite_idx" ON "eval_suite_test_cases" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "eval_suite_test_cases_org_idx" ON "eval_suite_test_cases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "eval_suites_agent_sop_idx" ON "eval_suites" USING btree ("agent_id","sop_id");--> statement-breakpoint
CREATE INDEX "eval_suites_org_idx" ON "eval_suites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "eval_suites_agent_idx" ON "eval_suites" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "eval_suites_sop_idx" ON "eval_suites" USING btree ("sop_id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_test_case_id_eval_suite_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."eval_suite_test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_suite_run_idx" ON "eval_runs" USING btree ("suite_run_id");--> statement-breakpoint
-- Extend eval_source_type enum (cannot drop+recreate if rows exist with old values)
ALTER TYPE "public"."eval_source_type" ADD VALUE IF NOT EXISTS 'suite';--> statement-breakpoint
ALTER TYPE "public"."eval_source_type" ADD VALUE IF NOT EXISTS 'replay_test';--> statement-breakpoint
ALTER TYPE "public"."eval_source_type" ADD VALUE IF NOT EXISTS 'live';--> statement-breakpoint
-- RLS policies for eval suite tables
CREATE POLICY "eval_suites_org_isolation" ON "eval_suites" USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suites_org_insert" ON "eval_suites" FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_test_cases_org_isolation" ON "eval_suite_test_cases" USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_test_cases_org_insert" ON "eval_suite_test_cases" FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_evaluators_org_isolation" ON "eval_suite_evaluators" USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_evaluators_org_insert" ON "eval_suite_evaluators" FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_runs_org_isolation" ON "eval_suite_runs" USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_suite_runs_org_insert" ON "eval_suite_runs" FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);