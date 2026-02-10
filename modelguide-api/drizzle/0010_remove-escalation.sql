ALTER TABLE "sessions" DROP COLUMN "escalation_ref";--> statement-breakpoint
ALTER TABLE "public"."sessions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."sessions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "sessions" SET "status" = 'completed' WHERE "status" = 'escalated';--> statement-breakpoint
DROP TYPE "public"."session_status";--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
ALTER TABLE "public"."sessions" ALTER COLUMN "status" SET DATA TYPE "public"."session_status" USING "status"::"public"."session_status";--> statement-breakpoint
ALTER TABLE "public"."sessions" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."session_status";