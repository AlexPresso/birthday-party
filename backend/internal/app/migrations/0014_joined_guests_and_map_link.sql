-- Joined guests and the party's map link ------------------------------------------
--
-- joined_at is when a guest first opened one of their invitations: sending the
-- invitations in bulk skips everyone who already came in. Invitations are
-- replaced when renewed, so earlier entries are recovered from sessions too.
ALTER TABLE guests ADD COLUMN joined_at TIMESTAMPTZ;
UPDATE guests g SET joined_at = (
    SELECT MIN(entered) FROM (
        SELECT used_at AS entered FROM invitations WHERE guest_id = g.id AND used_at IS NOT NULL
        UNION ALL
        SELECT created_at FROM sessions WHERE guest_id = g.id
    ) entries
);

-- A web address of a map showing the location, such as a Google Maps link.
ALTER TABLE party
    ADD COLUMN map_url TEXT NOT NULL DEFAULT ''
        CHECK (map_url = '' OR (map_url LIKE 'https://%' AND char_length(map_url) <= 500));
