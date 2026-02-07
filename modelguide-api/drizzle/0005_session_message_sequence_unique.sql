DROP INDEX IF EXISTS "session_messages_sequence_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "session_messages_session_sequence_unique" ON "session_messages" USING btree ("session_id","sequence_number");--> statement-breakpoint
