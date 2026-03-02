CREATE TYPE "public"."sop_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "agent_sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"sop_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sop_id" uuid NOT NULL,
	"step_id" varchar(100) NOT NULL,
	"order" integer NOT NULL,
	"instruction" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"connector_id" uuid,
	"tool_slug" varchar(100),
	"resolved_name" varchar(255),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"catalog_slugs" text[] DEFAULT '{}',
	"definition" jsonb DEFAULT '{}'::jsonb,
	"version" varchar(50) DEFAULT '1.0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sop_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sop_id" uuid NOT NULL,
	"version" varchar(50) NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb,
	"change_summary" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "sop_status" DEFAULT 'draft' NOT NULL,
	"version" varchar(50) DEFAULT '1.0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_sops" ADD CONSTRAINT "agent_sops_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sops" ADD CONSTRAINT "agent_sops_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_sop_id_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_template_id_sop_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sop_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sops_unique" ON "agent_sops" USING btree ("agent_id","sop_id");--> statement-breakpoint
CREATE INDEX "agent_sops_agent_idx" ON "agent_sops" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_sops_sop_idx" ON "agent_sops" USING btree ("sop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_steps_sop_step_id_unique" ON "sop_steps" USING btree ("sop_id","step_id");--> statement-breakpoint
CREATE INDEX "sop_steps_sop_idx" ON "sop_steps" USING btree ("sop_id");--> statement-breakpoint
CREATE INDEX "sop_steps_connector_idx" ON "sop_steps" USING btree ("connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sop_templates_slug_unique" ON "sop_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sop_templates_is_active_idx" ON "sop_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "sop_versions_sop_idx" ON "sop_versions" USING btree ("sop_id");--> statement-breakpoint
CREATE INDEX "sop_versions_created_at_idx" ON "sop_versions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sops_org_slug_unique" ON "sops" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "sops_org_idx" ON "sops" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sops_org_status_idx" ON "sops" USING btree ("organization_id","status");

-- ============================================================================
-- RLS policies for sops table (org-scoped, same pattern as other tenant tables)
-- ============================================================================

ALTER TABLE sops FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON sops
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON sops
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');