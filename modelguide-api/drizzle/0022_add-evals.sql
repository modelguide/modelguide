CREATE TYPE "public"."eval_score_result" AS ENUM('pass', 'fail', 'skip', 'error');--> statement-breakpoint
CREATE TYPE "public"."eval_source_type" AS ENUM('sop');--> statement-breakpoint
CREATE TYPE "public"."eval_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."evaluator_type" AS ENUM('tool_called', 'tool_input_contains', 'no_tool_called', 'llm_judge');--> statement-breakpoint
CREATE TABLE "eval_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"evaluator_type" "evaluator_type" NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "eval_run_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"eval_config_id" uuid,
	"name" varchar(255) NOT NULL,
	"score_order" integer NOT NULL,
	"required" boolean NOT NULL,
	"evaluator_type" "evaluator_type" NOT NULL,
	"result" "eval_score_result" NOT NULL,
	"reasoning" text NOT NULL,
	"failure_classification" varchar(50),
	"expected" jsonb,
	"actual" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_run_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_type" "eval_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "eval_status" DEFAULT 'pending' NOT NULL,
	"passed" boolean,
	"duration_ms" integer,
	"triggered_by" uuid,
	"external_run_id" varchar(255),
	"external_run_url" varchar(500),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD COLUMN "eval_config_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_configs" ADD CONSTRAINT "eval_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_configs" ADD CONSTRAINT "eval_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_scores" ADD CONSTRAINT "eval_run_scores_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_scores" ADD CONSTRAINT "eval_run_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_scores" ADD CONSTRAINT "eval_run_scores_eval_config_id_eval_configs_id_fk" FOREIGN KEY ("eval_config_id") REFERENCES "public"."eval_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_configs_org_idx" ON "eval_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "eval_configs_evaluator_type_idx" ON "eval_configs" USING btree ("evaluator_type");--> statement-breakpoint
CREATE INDEX "eval_run_scores_run_idx" ON "eval_run_scores" USING btree ("eval_run_id");--> statement-breakpoint
CREATE INDEX "eval_run_scores_config_idx" ON "eval_run_scores" USING btree ("eval_config_id");--> statement-breakpoint
CREATE INDEX "eval_run_scores_org_idx" ON "eval_run_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_active_unique" ON "eval_runs" USING btree ("session_id","source_type","source_id") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "eval_runs_session_idx" ON "eval_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "eval_runs_source_idx" ON "eval_runs" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "eval_runs_created_idx" ON "eval_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_org_idx" ON "eval_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sop_steps_eval_config_idx" ON "sop_steps" USING btree ("eval_config_id");--> statement-breakpoint

-- ============================================================================
-- RLS policies for eval tables (org-scoped, same pattern as other tenant tables)
-- ============================================================================

ALTER TABLE eval_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON eval_configs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON eval_configs
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE eval_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON eval_runs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON eval_runs
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE eval_run_scores FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON eval_run_scores
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON eval_run_scores
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');