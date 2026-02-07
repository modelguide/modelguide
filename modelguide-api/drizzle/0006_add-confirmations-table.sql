CREATE TYPE "public"."confirmation_status" AS ENUM('pending', 'consumed', 'expired');--> statement-breakpoint
CREATE TABLE "confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"mcp_tool_name" varchar(255) NOT NULL,
	"args" jsonb,
	"status" "confirmation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confirmations_org_idx" ON "confirmations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "confirmations_agent_idx" ON "confirmations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "confirmations_status_expires_idx" ON "confirmations" USING btree ("status","expires_at");--> statement-breakpoint

ALTER TABLE "confirmations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation_policy ON confirmations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint

CREATE POLICY bypass_rls_policy ON confirmations
  FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');