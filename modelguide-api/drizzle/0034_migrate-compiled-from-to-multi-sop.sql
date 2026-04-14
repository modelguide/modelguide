-- Migrate compiled_from JSONB from single-SOP shape to multi-SOP array shape.
-- Old: { sopId, sopName, stepCount, guardrailIds, toolCount }
-- New: { sops: [{ sopId, sopName, stepCount }], guardrailIds, toolCount }
-- Idempotent: only touches rows with old shape (has "sopId" key, no "sops" key).

UPDATE agents
SET compiled_from = jsonb_build_object(
  'sops', jsonb_build_array(
    jsonb_build_object(
      'sopId',     compiled_from->>'sopId',
      'sopName',   compiled_from->>'sopName',
      'stepCount', (compiled_from->>'stepCount')::int
    )
  ),
  'guardrailIds', COALESCE(compiled_from->'guardrailIds', '[]'::jsonb),
  'toolCount',    COALESCE((compiled_from->>'toolCount')::int, 0)
)
WHERE compiled_from IS NOT NULL
  AND compiled_from ? 'sopId'
  AND NOT compiled_from ? 'sops';
