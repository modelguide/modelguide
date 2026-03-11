CREATE TYPE "public"."knowledge_base_type" AS ENUM('guardrail');--> statement-breakpoint
CREATE TABLE "agent_knowledge_base" (
	"agent_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "knowledge_base_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "knowledge_base" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_knowledge_base" ADD CONSTRAINT "agent_knowledge_base_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_base" ADD CONSTRAINT "agent_knowledge_base_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_kb_unique" ON "agent_knowledge_base" USING btree ("agent_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX "agent_kb_agent_idx" ON "agent_knowledge_base" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_kb_kb_idx" ON "agent_knowledge_base" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_org_type_slug_unique" ON "knowledge_base" USING btree ("organization_id","type","slug");--> statement-breakpoint
CREATE INDEX "kb_org_type_active_idx" ON "knowledge_base" USING btree ("organization_id","type","is_active");--> statement-breakpoint

CREATE POLICY tenant_isolation_policy ON knowledge_base
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY bypass_rls_policy ON knowledge_base
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_base TO modelguide_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_knowledge_base TO modelguide_app;