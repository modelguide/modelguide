CREATE TYPE "public"."tool_status" AS ENUM('success', 'error');--> statement-breakpoint
ALTER TABLE "session_messages" ADD COLUMN "tool_status" "tool_status";