-- Add platform_api_key to secret_type enum
ALTER TYPE "public"."secret_type" ADD VALUE 'platform_api_key';--> statement-breakpoint

-- Add slug column to agents with a default derived from name
ALTER TABLE "agents" ADD COLUMN "slug" varchar(100);--> statement-breakpoint

-- Backfill existing agents: generate slug from name (lowercase, replace non-alphanumeric with hyphens)
UPDATE "agents" SET "slug" = lower(regexp_replace(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'), '^-|-$', '', 'g'));--> statement-breakpoint

-- Make slug NOT NULL after backfill
ALTER TABLE "agents" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- Add unique index on (organization_id, slug)
CREATE UNIQUE INDEX "agents_org_slug_unique" ON "agents" ("organization_id","slug");
