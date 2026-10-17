ALTER TABLE welcome ADD COLUMN required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE welcome ADD COLUMN generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0);

-- Opening access now unlocks every step while guests keep their own position.
DO $$
DECLARE constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'welcome'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%is_open%'
    LOOP
        EXECUTE format('ALTER TABLE welcome DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

CREATE SEQUENCE welcome_progress_revision_seq;
SELECT setval('welcome_progress_revision_seq', GREATEST(
    (SELECT revision FROM welcome WHERE id = 1),
    COALESCE((SELECT MAX(welcome_revision) FROM upload_jobs), 0)
) + 1, FALSE);

CREATE TABLE guest_welcome_progress (
    guest_id BIGINT PRIMARY KEY REFERENCES guests(id),
    generation BIGINT NOT NULL CHECK (generation > 0),
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 12),
    revision BIGINT NOT NULL DEFAULT nextval('welcome_progress_revision_seq'),
    completed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Preserve a running sequence and the step already visible to existing guests.
UPDATE welcome SET generation = 1, revision = revision + 1 WHERE NOT is_open;
INSERT INTO guest_welcome_progress(guest_id, generation, position)
SELECT g.id, w.generation, w.current_step
FROM guests g CROSS JOIN welcome w
WHERE NOT w.is_open AND EXISTS (SELECT 1 FROM sessions s WHERE s.guest_id = g.id);
