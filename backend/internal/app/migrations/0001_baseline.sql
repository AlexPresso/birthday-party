-- Identities and access ------------------------------------------------------

CREATE TABLE guests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('guest', 'admin')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Small normalized avatars stay with the guest so replacement and removal are atomic.
    avatar_jpeg BYTEA CHECK (octet_length(avatar_jpeg) BETWEEN 1 AND 131072),
    avatar_version BIGINT NOT NULL DEFAULT 0 CHECK (avatar_version >= 0),
    CONSTRAINT guests_avatar_requires_version CHECK (avatar_jpeg IS NULL OR avatar_version > 0)
);

CREATE TABLE invitations (
    token_hash TEXT PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);
CREATE INDEX invitations_guest ON invitations(guest_id);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_guest ON sessions(guest_id);

-- Party details and configuration ---------------------------------------------

CREATE TABLE party (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Europe/Zurich',
    date TIMESTAMPTZ,
    location TEXT NOT NULL DEFAULT ''
);
INSERT INTO party(id) VALUES (1);

-- Startup inserts the single row from the environment when it is absent.
CREATE TABLE product_configuration (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    age INTEGER NOT NULL CHECK (age BETWEEN 1 AND 150),
    invitation JSONB NOT NULL,
    image_size_mb INTEGER NOT NULL CHECK (image_size_mb BETWEEN 1 AND 1024),
    video_size_mb INTEGER NOT NULL CHECK (video_size_mb BETWEEN 1 AND 1024)
);

-- Welcome sequence -------------------------------------------------------------

-- Access stays open until the host starts the welcome sequence.
CREATE TABLE welcome (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0),
    current_step SMALLINT NOT NULL DEFAULT 0,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT welcome_steps_bounded CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 12),
    CONSTRAINT welcome_current_step_unlocked CHECK (current_step BETWEEN 0 AND jsonb_array_length(steps))
);
INSERT INTO welcome(id) VALUES (1);

-- Guest navigation and widget uploads are checked against this token.
CREATE SEQUENCE welcome_progress_revision_seq;

CREATE TABLE guest_welcome_progress (
    guest_id BIGINT PRIMARY KEY REFERENCES guests(id),
    generation BIGINT NOT NULL CHECK (generation > 0),
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 12),
    revision BIGINT NOT NULL DEFAULT nextval('welcome_progress_revision_seq'),
    completed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Guestbook -------------------------------------------------------------------

-- The owner stays private for anonymous entries; it only decides who may delete.
CREATE TABLE entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

-- Media ------------------------------------------------------------------------

CREATE TABLE media_categories (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    is_public BOOLEAN NOT NULL DEFAULT FALSE
);

-- A null category is the main gallery.
CREATE TABLE photos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    category_id BIGINT REFERENCES media_categories(id),
    filename TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    byte_size BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX photos_category_page ON photos(category_id, id DESC);

-- The durable upload queue. A job keeps the destination captured at acceptance.
CREATE TABLE upload_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    client_upload_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    filename TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    input_format TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    category_id BIGINT REFERENCES media_categories(id),
    welcome_revision BIGINT CHECK (welcome_revision >= 0),
    welcome_widget_index INTEGER CHECK (welcome_widget_index BETWEEN 0 AND 11),
    -- Each claim counts as an attempt and names it, so a superseded worker cannot settle the job.
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    attempt_id TEXT,
    -- A retry waits until this instant; queued jobs are claimed in this order.
    available_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    error_code TEXT,
    photo_id BIGINT REFERENCES photos(id) ON DELETE SET NULL,
    UNIQUE (guest_id, client_upload_id),
    CONSTRAINT upload_jobs_welcome_widget CHECK ((welcome_revision IS NULL) = (welcome_widget_index IS NULL))
);
CREATE INDEX upload_jobs_pending ON upload_jobs(id) WHERE status IN ('queued', 'processing');
CREATE INDEX upload_jobs_queue ON upload_jobs(available_at, id) WHERE status = 'queued';
CREATE INDEX upload_jobs_guest ON upload_jobs(guest_id, id DESC);
CREATE INDEX upload_jobs_photo ON upload_jobs(photo_id) WHERE photo_id IS NOT NULL;

-- Notifications ---------------------------------------------------------------

CREATE TABLE notification_keys (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL
);

CREATE TABLE notification_subscriptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    endpoint_hash TEXT NOT NULL UNIQUE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    locale TEXT NOT NULL CHECK (locale IN ('en', 'fr', 'de', 'it', 'es')),
    version BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX notification_subscriptions_guest ON notification_subscriptions(guest_id);
CREATE INDEX notification_subscriptions_session ON notification_subscriptions(session_hash);

-- One row per subscription: a newer welcome update replaces an undelivered one.
CREATE TABLE notification_outbox (
    subscription_id BIGINT PRIMARY KEY REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
    subscription_version BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    generation BIGINT NOT NULL,
    unlocked_step SMALLINT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('welcome_step', 'welcome_open')),
    attempts SMALLINT NOT NULL DEFAULT 0,
    next_attempt TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Programme -------------------------------------------------------------------

CREATE TABLE events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    teaser TEXT NOT NULL,
    starts_at TIMESTAMPTZ,
    unlock_at TIMESTAMPTZ
);

-- An interactive event has exactly one activity; an ordinary event has none.
CREATE TABLE programme_activities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('vote', 'questions')),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE programme_votes (
    activity_id BIGINT PRIMARY KEY REFERENCES programme_activities(id) ON DELETE CASCADE,
    question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 240),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'revealed')),
    allow_self_vote BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE programme_vote_candidates (
    activity_id BIGINT NOT NULL REFERENCES programme_votes(activity_id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (activity_id, guest_id),
    UNIQUE (activity_id, position)
);

CREATE TABLE programme_ballots (
    activity_id BIGINT NOT NULL REFERENCES programme_votes(activity_id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    candidate_id BIGINT NOT NULL,
    PRIMARY KEY (activity_id, guest_id),
    FOREIGN KEY (activity_id, candidate_id)
        REFERENCES programme_vote_candidates(activity_id, guest_id) ON DELETE CASCADE
);
CREATE INDEX programme_ballots_candidate ON programme_ballots(activity_id, candidate_id);

CREATE TABLE programme_question_rounds (
    activity_id BIGINT PRIMARY KEY REFERENCES programme_activities(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    jokers_used INTEGER NOT NULL DEFAULT 0 CHECK (jokers_used BETWEEN 0 AND 2)
);

-- Authors and voters stay private; no response exposes them.
CREATE TABLE programme_questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES programme_question_rounds(activity_id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'joker'))
);
CREATE INDEX programme_questions_activity ON programme_questions(activity_id, id);

CREATE TABLE programme_question_upvotes (
    question_id BIGINT NOT NULL REFERENCES programme_questions(id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    PRIMARY KEY (question_id, guest_id)
);
