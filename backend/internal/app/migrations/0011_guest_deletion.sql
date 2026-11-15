-- Permanent guest deletion ------------------------------------------------------
--
-- The host can delete a guest whose access was removed. Their guestbook
-- messages, media and questions stay without an author; the message becomes
-- anonymous, so it never shows a name again.
ALTER TABLE entries ALTER COLUMN guest_id DROP NOT NULL;
ALTER TABLE entries
    ADD CONSTRAINT entries_author_or_anonymous CHECK (guest_id IS NOT NULL OR anonymous);
ALTER TABLE photos ALTER COLUMN guest_id DROP NOT NULL;
ALTER TABLE programme_questions ALTER COLUMN guest_id DROP NOT NULL;
