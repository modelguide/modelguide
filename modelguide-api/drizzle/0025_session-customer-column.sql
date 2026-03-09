ALTER TABLE "session_feedback" RENAME COLUMN "user_identifier" TO "customer_external_id";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer" jsonb;--> statement-breakpoint
CREATE INDEX "sessions_org_customer_email_idx" ON "sessions" USING btree ("organization_id",("customer"->>'email'));--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "user_identifier";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "user_metadata";