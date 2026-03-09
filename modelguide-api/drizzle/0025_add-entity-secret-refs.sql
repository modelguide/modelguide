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

-- Backfill connectors.secrets: for each connector, find the first config schema field
-- with type "secret" and map it to the owned secret's ID. This correctly keys by the
-- catalog field name (e.g. "secretApiKey" for Medusa, "apiToken" for Zendesk) rather
-- than by secret_type which would mismatch at runtime.
UPDATE "connectors" c
SET "secrets" = (
  SELECT COALESCE(
    jsonb_object_agg(sf.field_name, s.id),
    '{}'::jsonb
  )
  FROM "secrets" s
  -- Find the secret field name from the catalog's configSchema
  CROSS JOIN LATERAL (
    SELECT key AS field_name
    FROM jsonb_each(
      (SELECT cat.config_schema FROM "connectors_catalog" cat WHERE cat.id = c.connector_catalog_id)
    )
    WHERE value->>'type' = 'secret'
    LIMIT 1
  ) sf
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