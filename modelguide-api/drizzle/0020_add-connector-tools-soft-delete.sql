DROP INDEX "connector_tools_connector_slug_unique";--> statement-breakpoint
ALTER TABLE "connector_tools" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_tools_connector_slug_unique" ON "connector_tools" USING btree ("connector_id","slug") WHERE "connector_tools"."deleted_at" is null;