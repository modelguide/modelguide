ALTER TYPE "public"."agent_type" RENAME TO "modality";--> statement-breakpoint
ALTER TYPE "public"."modality" ADD VALUE 'text';--> statement-breakpoint
ALTER TABLE "agents" RENAME COLUMN "agent_type" TO "modality";