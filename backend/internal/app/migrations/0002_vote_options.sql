-- Vote options ------------------------------------------------------------------
--
-- A vote offers either guests or labels written by the host, which guests may
-- complete with write-ins. Counts are visible as soon as the vote is, so the
-- separate "revealed" phase disappears: a revealed vote is a closed one.

ALTER TABLE programme_votes
    ADD COLUMN choices TEXT NOT NULL DEFAULT 'guests' CHECK (choices IN ('guests', 'custom')),
    ADD COLUMN allow_write_ins BOOLEAN NOT NULL DEFAULT FALSE;
-- Every existing vote offers guests; new votes always state their source.
ALTER TABLE programme_votes ALTER COLUMN choices DROP DEFAULT;

UPDATE programme_votes SET status = 'closed' WHERE status = 'revealed';

ALTER TABLE programme_votes
    DROP CONSTRAINT programme_votes_status_check,
    ADD CONSTRAINT programme_votes_status_check CHECK (status IN ('draft', 'open', 'closed')),
    ADD CONSTRAINT programme_votes_self_vote_needs_guests CHECK (NOT allow_self_vote OR choices = 'guests'),
    ADD CONSTRAINT programme_votes_write_ins_need_custom CHECK (NOT allow_write_ins OR choices = 'custom');

-- An option is either a guest or a label. Its ID is what ballots and the API
-- refer to; IDs grow in the order the host listed the options.
CREATE TABLE programme_vote_options (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES programme_votes(activity_id) ON DELETE CASCADE,
    guest_id BIGINT REFERENCES guests(id),
    label TEXT CHECK (char_length(label) BETWEEN 1 AND 80),
    -- Added by a guest while the vote was open, rather than by the host.
    write_in BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT programme_vote_options_guest_or_label CHECK ((guest_id IS NULL) <> (label IS NULL)),
    CONSTRAINT programme_vote_options_write_in_has_label CHECK (NOT write_in OR label IS NOT NULL),
    -- Lets a ballot reference an option of its own vote only; also lists a vote's options.
    UNIQUE (activity_id, id),
    UNIQUE (activity_id, guest_id)
);
-- Two labels differing only by case are the same option.
CREATE UNIQUE INDEX programme_vote_options_label ON programme_vote_options(activity_id, lower(label));

INSERT INTO programme_vote_options(activity_id, guest_id, created_at)
SELECT activity_id, guest_id, CURRENT_TIMESTAMP
FROM programme_vote_candidates
ORDER BY activity_id, position;

-- Ballots follow their candidate to the option that replaces it. The primary
-- key (activity_id, guest_id) still finds a voter's ballot.
ALTER TABLE programme_ballots ADD COLUMN option_id BIGINT;

UPDATE programme_ballots AS b
SET option_id = o.id
FROM programme_vote_options AS o
WHERE o.activity_id = b.activity_id AND o.guest_id = b.candidate_id;

-- Dropping the column also drops its foreign key and index.
ALTER TABLE programme_ballots
    DROP COLUMN candidate_id,
    ALTER COLUMN option_id SET NOT NULL,
    ADD CONSTRAINT programme_ballots_option_fkey FOREIGN KEY (activity_id, option_id)
        REFERENCES programme_vote_options(activity_id, id) ON DELETE CASCADE;
-- Counts the votes of each option of one vote and serves the cascade above.
CREATE INDEX programme_ballots_option ON programme_ballots(activity_id, option_id);

DROP TABLE programme_vote_candidates;
