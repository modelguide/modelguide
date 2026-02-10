CREATE TYPE "public"."agent_platform" AS ENUM('custom', 'elevenlabs');--> statement-breakpoint
ALTER TYPE "public"."owner_type" ADD VALUE 'agent';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_platform" "public"."agent_platform" DEFAULT 'custom' NOT NULL;
