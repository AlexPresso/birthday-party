-- Appearance ------------------------------------------------------------------------
--
-- The host picks the app's theme and main colour. Both are public, like the
-- age and the invitation text, because the invitation page uses them. The
-- defaults keep the look the app was designed with.

ALTER TABLE product_configuration
    ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
    ADD COLUMN accent TEXT NOT NULL DEFAULT '#ff6a1f' CHECK (accent ~ '^#[0-9a-f]{6}$');
