-- Normalize any dangling eval_config_id references before enforcing FK.
UPDATE "sop_steps" AS ss
SET "eval_config_id" = NULL
WHERE
  ss."eval_config_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "eval_configs" ec
    WHERE ec."id" = ss."eval_config_id"
  );

ALTER TABLE "sop_steps"
ADD CONSTRAINT "sop_steps_eval_config_id_eval_configs_id_fk"
FOREIGN KEY ("eval_config_id")
REFERENCES "public"."eval_configs"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION;
