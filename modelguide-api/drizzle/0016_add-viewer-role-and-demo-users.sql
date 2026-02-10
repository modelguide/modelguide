ALTER TYPE "public"."user_role" ADD VALUE 'viewer';--> statement-breakpoint
CREATE TABLE "demo_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"source" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_users_email_idx" ON "demo_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "demo_users_created_at_idx" ON "demo_users" USING btree ("created_at");