-- Storage alerts -----------------------------------------------------------------
--
-- Administrators are told when the media disk reaches its warning range and
-- when files are refused for lack of room.

-- warned is true while the disk stays in its warning range, so the alert is
-- sent once per crossing. full_notified_at spaces alerts for refused files.
CREATE TABLE storage_alert (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    warned BOOLEAN NOT NULL DEFAULT FALSE,
    full_notified_at TIMESTAMPTZ
);
INSERT INTO storage_alert(id) VALUES (1);

-- One pending alert per subscription and kind; a newer one replaces it.
CREATE TABLE storage_notification_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
    subscription_version BIGINT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('storage_warning', 'storage_full')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    next_attempt TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (subscription_id, kind)
);
CREATE INDEX storage_notification_outbox_due ON storage_notification_outbox(next_attempt);
