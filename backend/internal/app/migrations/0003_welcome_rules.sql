-- Welcome rules -----------------------------------------------------------------
--
-- A rules widget holds a guest on its step until they tick every rule. The
-- positions accepted in the current run are kept with the guest's progress, so
-- they are read and locked with it and start empty in each new run.

ALTER TABLE guest_welcome_progress
    ADD COLUMN accepted_rules SMALLINT[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(accepted_rules) <= 12 AND accepted_rules <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[]);
