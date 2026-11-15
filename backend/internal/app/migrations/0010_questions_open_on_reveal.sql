-- No Filter rounds open with their event ----------------------------------------
--
-- A question round has no draft any more: guests may ask and upvote as soon
-- as the event is revealed to them, and the host can only close the round.
-- Rounds still waiting in draft open now.
UPDATE programme_question_rounds SET status = 'open' WHERE status = 'draft';
ALTER TABLE programme_question_rounds ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE programme_question_rounds DROP CONSTRAINT programme_question_rounds_status_check;
ALTER TABLE programme_question_rounds
    ADD CONSTRAINT programme_question_rounds_status_check CHECK (status IN ('open', 'closed'));
