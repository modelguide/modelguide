ALTER TABLE "sop_steps" ADD COLUMN "connector_tool_id" uuid;--> statement-breakpoint

-- Backfill: resolve connector_id + tool_slug → connector_tool_id (active tools first)
UPDATE sop_steps s SET connector_tool_id = ct.id
FROM connector_tools ct
WHERE s.connector_id = ct.connector_id AND s.tool_slug = ct.slug AND ct.deleted_at IS NULL;--> statement-breakpoint

-- Fallback pass for soft-deleted tools
UPDATE sop_steps s SET connector_tool_id = ct.id
FROM connector_tools ct
WHERE s.connector_id = ct.connector_id AND s.tool_slug = ct.slug
  AND s.connector_tool_id IS NULL AND s.connector_id IS NOT NULL;--> statement-breakpoint

-- Drop old FK, index, and columns
ALTER TABLE "sop_steps" DROP CONSTRAINT "sop_steps_connector_id_connectors_id_fk";--> statement-breakpoint
DROP INDEX "sop_steps_connector_idx";--> statement-breakpoint
ALTER TABLE "sop_steps" DROP COLUMN "connector_id";--> statement-breakpoint
ALTER TABLE "sop_steps" DROP COLUMN "tool_slug";--> statement-breakpoint

-- Add new FK and index
ALTER TABLE "sop_steps" ADD CONSTRAINT "sop_steps_connector_tool_id_connector_tools_id_fk" FOREIGN KEY ("connector_tool_id") REFERENCES "public"."connector_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_steps_connector_tool_idx" ON "sop_steps" USING btree ("connector_tool_id");