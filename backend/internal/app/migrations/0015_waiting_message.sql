-- The waiting message -----------------------------------------------------------------
--
-- A text the host writes for guests who opened their invitation while the
-- welcome has not shown its first step yet. Null keeps the interface's line.
ALTER TABLE product_configuration
    ADD COLUMN waiting_message TEXT CHECK (char_length(waiting_message) BETWEEN 1 AND 2000);
