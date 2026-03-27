-- Lift evaluators from test-case level to suite level.
-- Step 1: Drop old FK constraint
ALTER TABLE "eval_suite_evaluators" DROP CONSTRAINT "eval_suite_evaluators_test_case_id_eval_suite_test_cases_id_fk";--> statement-breakpoint
-- Step 2: Map test_case_id values to their parent suite_id before renaming
UPDATE "eval_suite_evaluators" e
SET "test_case_id" = tc."suite_id"
FROM "eval_suite_test_cases" tc
WHERE e."test_case_id" = tc."id";--> statement-breakpoint
-- Step 3: Rename column
ALTER TABLE "eval_suite_evaluators" RENAME COLUMN "test_case_id" TO "suite_id";--> statement-breakpoint
-- Step 4: Drop old index and create new one
DROP INDEX IF EXISTS "eval_suite_evaluators_test_case_idx";--> statement-breakpoint
CREATE INDEX "eval_suite_evaluators_suite_idx" ON "eval_suite_evaluators" USING btree ("suite_id");--> statement-breakpoint
-- Step 5: Add new FK constraint pointing to eval_suites
ALTER TABLE "eval_suite_evaluators" ADD CONSTRAINT "eval_suite_evaluators_suite_id_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."eval_suites"("id") ON DELETE cascade ON UPDATE no action;
