CREATE TABLE "simulation_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"traits" text[] DEFAULT '{}',
	"max_turns" integer,
	"email" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "simulation_personas_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
ALTER TABLE "simulation_personas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulation_personas" ADD CONSTRAINT "simulation_personas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "simulation_personas_org_idx" ON "simulation_personas" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "simulation_personas_org_isolation" ON "simulation_personas" USING ("organization_id" = current_setting('app.organization_id')::uuid);--> statement-breakpoint
CREATE POLICY "simulation_personas_org_insert" ON "simulation_personas" FOR INSERT WITH CHECK ("organization_id" = current_setting('app.organization_id')::uuid);
