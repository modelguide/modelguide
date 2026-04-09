CREATE TYPE "public"."model_family" AS ENUM('gpt', 'claude', 'gemini', 'generic');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model_family" "model_family" DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "prompt_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
