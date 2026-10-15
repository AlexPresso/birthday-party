-- Preserve existing instructions and progress while making the optional action explicit.
UPDATE welcome
SET steps = (
    SELECT COALESCE(
        jsonb_agg('{"action": null}'::jsonb || item ORDER BY position),
        '[]'::jsonb
    )
    FROM jsonb_array_elements(welcome.steps) WITH ORDINALITY AS existing(item, position)
);
