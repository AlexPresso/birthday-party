-- Guestbook voice notes -----------------------------------------------------------
--
-- A guestbook entry may carry one voice note, re-encoded by the server as mono
-- AAC in MP4. It lives beside its entry in PostgreSQL, like avatars, so the
-- entry and its recording are written, deleted and backed up together. peaks
-- holds the waveform the interface draws: 48 levels from 0 to 255.
CREATE TABLE guestbook_voice_notes (
    entry_id BIGINT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1 AND 302000),
    peaks BYTEA NOT NULL CHECK (octet_length(peaks) = 48),
    audio BYTEA NOT NULL CHECK (octet_length(audio) BETWEEN 1 AND 4194304)
);
