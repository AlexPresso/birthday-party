-- Each former nested activity becomes an event. Reuse the first activity's
-- parent so existing event links survive, and copy all authored metadata for
-- additional activities without changing their identities or ballots.
DO $$
DECLARE
    activity RECORD;
    target_event_id BIGINT;
BEGIN
    FOR activity IN
        SELECT a.id, a.event_id,
               row_number() OVER (PARTITION BY a.event_id ORDER BY a.position, a.id) AS ordinal
        FROM programme_activities a
        ORDER BY a.event_id, a.position, a.id
    LOOP
        IF activity.ordinal > 1 THEN
            INSERT INTO events(title, description, teaser, starts_at, unlock_at)
            SELECT title, description, teaser, starts_at, unlock_at
            FROM events WHERE id = activity.event_id
            RETURNING id INTO target_event_id;

            UPDATE programme_activities SET event_id = target_event_id, position = 0
            WHERE id = activity.id;
        ELSE
            UPDATE programme_activities SET position = 0 WHERE id = activity.id;
        END IF;
    END LOOP;
END $$;

ALTER TABLE programme_activities ADD CONSTRAINT programme_activity_event_unique UNIQUE (event_id);
ALTER TABLE programme_activities ADD CONSTRAINT programme_activity_single_position CHECK (position = 0);
