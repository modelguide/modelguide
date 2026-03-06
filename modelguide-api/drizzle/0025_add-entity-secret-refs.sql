CREATE TYPE "public"."secret_scope" AS ENUM('connector', 'agent');--> statement-breakpoint
ALTER TABLE "secrets" ALTER COLUMN "owner_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "secrets" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "secrets" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "secrets" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "scope" "secret_scope";--> statement-breakpoint
CREATE INDEX "secrets_scope_idx" ON "secrets" USING btree ("organization_id","scope");--> statement-breakpoint

-- Backfill: set scope from legacy ownerType
-- Cast owner_type::text to avoid "unsafe use of new enum value" in same transaction
UPDATE "secrets" SET "scope" = 'connector' WHERE "owner_type"::text = 'connector';--> statement-breakpoint
UPDATE "secrets" SET "scope" = 'agent'     WHERE "owner_type"::text = 'agent';--> statement-breakpoint

-- Backfill connectors.secrets: for each connector find secrets with ownerType=connector
-- and build a JSON map of { secretType: secretId } (best-effort; uses secret_type as field name)
UPDATE "connectors" c
SET "secrets" = (
  SELECT COALESCE(
    jsonb_object_agg(s.secret_type, s.id),
    '{}'::jsonb
  )
  FROM "secrets" s
  WHERE s.owner_type::text = 'connector'
    AND s.owner_id = c.id
);--> statement-breakpoint

-- Backfill agents.secrets: for each agent find secrets with ownerType=agent
UPDATE "agents" a
SET "secrets" = (
  SELECT COALESCE(
    jsonb_object_agg(s.secret_type, s.id),
    '{}'::jsonb
  )
  FROM "secrets" s
  WHERE s.owner_type::text = 'agent'
    AND s.owner_id = a.id
);