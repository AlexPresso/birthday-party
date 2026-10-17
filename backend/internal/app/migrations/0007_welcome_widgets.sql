-- Preserve authored content and progress while replacing fixed fields with
-- ordered widgets. A revision change invalidates old in-flight welcome uploads.
UPDATE welcome
SET steps = (
    SELECT jsonb_agg(jsonb_build_object('widgets',
        jsonb_build_array(jsonb_build_object('type', 'title', 'text', item->>'title'))
        || CASE WHEN COALESCE(item->>'body', '') <> ''
            THEN jsonb_build_array(jsonb_build_object('type', 'text', 'text', item->>'body'))
            ELSE '[]'::jsonb END
        || CASE item->>'action'
            WHEN 'profile_photo' THEN '[{"type":"profile_photo"}]'::jsonb
            WHEN 'media_upload' THEN jsonb_build_array(jsonb_build_object('type', 'media_upload', 'mediaUpload', item->'mediaUpload'))
            ELSE '[]'::jsonb END
    ) ORDER BY position)
    FROM jsonb_array_elements(welcome.steps) WITH ORDINALITY AS existing(item, position)
), revision = revision + 1
WHERE jsonb_array_length(steps) > 0;

-- Already accepted jobs retain their old destination and can finish normally.
ALTER TABLE upload_jobs ADD COLUMN welcome_widget_index INTEGER
    CHECK (welcome_widget_index BETWEEN 0 AND 11);
ALTER TABLE upload_jobs ADD CONSTRAINT upload_jobs_widget_revision
    CHECK (welcome_widget_index IS NULL OR welcome_revision IS NOT NULL);
