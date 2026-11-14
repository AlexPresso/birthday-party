-- Programme notifications ---------------------------------------------------------
--
-- Guests are told when an event starts and when a surprise is revealed.

-- The host's switch, and how far the scheduler has announced. A moment at or
-- before announced_through has been handled; the worker advances it under a
-- row lock, so no moment is announced twice.
CREATE TABLE programme_notifications (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    announced_through TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00'
);
INSERT INTO programme_notifications(id) VALUES (1);

-- One row per subscription, event and moment. Unlike a welcome update, which
-- replaces the previous one, two events may be due for the same device.
-- title is what the programme showed guests when the row was queued.
CREATE TABLE programme_notification_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
    subscription_version BIGINT NOT NULL,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('programme_start', 'programme_unlock')),
    title TEXT NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    next_attempt TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (subscription_id, event_id, kind)
);
CREATE INDEX programme_notification_outbox_due ON programme_notification_outbox(next_attempt);
CREATE INDEX programme_notification_outbox_event ON programme_notification_outbox(event_id);
