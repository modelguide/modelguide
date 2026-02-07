UPDATE "session_messages" SET "occurred_at" = "created_at" WHERE "occurred_at" IS NULL;--> statement-breakpoint
CREATE INDEX "session_messages_session_occurred_idx" ON "session_messages" USING btree ("session_id","occurred_at");
