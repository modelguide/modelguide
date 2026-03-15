CREATE TYPE "public"."session_mode" AS ENUM('live', 'simulation');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mode" "session_mode" DEFAULT 'live' NOT NULL;