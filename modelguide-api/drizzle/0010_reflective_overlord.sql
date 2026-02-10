ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "session_feedback" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_feedback_source_ref_uniq" ON "session_feedback" USING btree ("session_id","feedback_source","feedback_ref");