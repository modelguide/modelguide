DROP INDEX "secrets_owner_idx";--> statement-breakpoint
ALTER TABLE "secrets" DROP COLUMN "owner_type";--> statement-breakpoint
ALTER TABLE "secrets" DROP COLUMN "owner_id";--> statement-breakpoint
DROP TYPE "public"."owner_type";