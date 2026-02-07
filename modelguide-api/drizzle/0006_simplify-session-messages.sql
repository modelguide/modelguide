DROP INDEX "session_messages_session_sequence_unique";--> statement-breakpoint
ALTER TABLE "session_messages" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_messages" DROP COLUMN "sequence_number";