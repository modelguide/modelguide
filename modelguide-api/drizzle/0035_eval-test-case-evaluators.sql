CREATE TYPE "public"."eval_suite_test_case_evaluator_override_type" AS ENUM('add', 'exclude');--> statement-breakpoint
CREATE TABLE "eval_test_case_evaluators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"eval_config_id" uuid NOT NULL,
	"override_type" "eval_suite_test_case_evaluator_override_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"source" "eval_suite_test_case_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_test_case_evaluators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_test_case_evaluators" ADD CONSTRAINT "eval_test_case_evaluators_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_test_case_evaluators" ADD CONSTRAINT "eval_test_case_evaluators_test_case_id_eval_suite_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."eval_suite_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_test_case_evaluators" ADD CONSTRAINT "eval_test_case_evaluators_eval_config_id_eval_configs_id_fk" FOREIGN KEY ("eval_config_id") REFERENCES "public"."eval_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_test_case_evaluators_test_case_idx" ON "eval_test_case_evaluators" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "eval_test_case_evaluators_config_idx" ON "eval_test_case_evaluators" USING btree ("eval_config_id");--> statement-breakpoint
CREATE INDEX "eval_test_case_evaluators_org_idx" ON "eval_test_case_evaluators" USING btree ("organization_id");--> statement-breakpoint
-- RLS policies: org-scoped access
CREATE POLICY "eval_test_case_evaluators_org_isolation" ON "eval_test_case_evaluators"
  USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "eval_test_case_evaluators_org_insert" ON "eval_test_case_evaluators"
  FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);
