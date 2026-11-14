-- Werewolf games ------------------------------------------------------------------
--
-- A third activity type: a companion for the hidden-role game played aloud. The
-- app deals the roles and keeps the board; it does not run turns.

ALTER TABLE programme_activities
    DROP CONSTRAINT programme_activities_type_check,
    ADD CONSTRAINT programme_activities_type_check CHECK (type IN ('vote', 'questions', 'werewolf'));

-- One game per werewolf event. Its row is the lock every command takes. The
-- game master is a guest picked by the host, or nobody yet.
CREATE TABLE programme_werewolf_games (
    activity_id BIGINT PRIMARY KEY REFERENCES programme_activities(id) ON DELETE CASCADE,
    game_master_id BIGINT REFERENCES guests(id),
    status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'running', 'finished')),
    phase TEXT NOT NULL DEFAULT 'day' CHECK (phase IN ('day', 'night')),
    hide_roles_of_dead BOOLEAN NOT NULL DEFAULT FALSE,
    ghost_messages BOOLEAN NOT NULL DEFAULT FALSE,
    -- Nights only exist for the ghost variant of a game that has started.
    CONSTRAINT programme_werewolf_games_night CHECK (phase = 'day' OR (ghost_messages AND status <> 'lobby'))
);

-- A role is either built in (a key the interface translates) or custom (a name
-- written by the game master). A description is only stored once written.
CREATE TABLE programme_werewolf_roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES programme_werewolf_games(activity_id) ON DELETE CASCADE,
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 19),
    role_key TEXT CHECK (role_key IN ('werewolf', 'villager', 'seer', 'witch', 'hunter', 'cupid', 'guard')),
    name TEXT CHECK (char_length(name) BETWEEN 1 AND 40),
    description TEXT CHECK (char_length(description) BETWEEN 1 AND 600),
    quantity SMALLINT NOT NULL CHECK (quantity BETWEEN 0 AND 60),
    CONSTRAINT programme_werewolf_roles_key_or_name CHECK ((role_key IS NULL) <> (name IS NULL)),
    -- Lets a player hold a role of their own game only.
    UNIQUE (activity_id, id),
    UNIQUE (activity_id, role_key),
    -- Twenty distinct positions bound the list. Checked at the end of a
    -- statement, so one update can reorder the roles.
    UNIQUE (activity_id, position) DEFERRABLE
);

-- id grows in join order. role_id is the dealt role: null in the lobby, where
-- nobody is dead or mayor either.
CREATE TABLE programme_werewolf_players (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES programme_werewolf_games(activity_id) ON DELETE CASCADE,
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    role_id BIGINT,
    alive BOOLEAN NOT NULL DEFAULT TRUE,
    mayor BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (activity_id, guest_id),
    FOREIGN KEY (activity_id, role_id) REFERENCES programme_werewolf_roles(activity_id, id),
    CONSTRAINT programme_werewolf_players_mayor_alive CHECK (NOT mayor OR alive),
    CONSTRAINT programme_werewolf_players_undealt CHECK (role_id IS NOT NULL OR (alive AND NOT mayor))
);
CREATE UNIQUE INDEX programme_werewolf_players_mayor ON programme_werewolf_players(activity_id) WHERE mayor;
-- Serves the foreign key when roles are removed.
CREATE INDEX programme_werewolf_players_role ON programme_werewolf_players(activity_id, role_id);

-- A ghost's message for the mayor: one per player and night. delivered marks
-- the one drawn when the day came.
CREATE TABLE programme_werewolf_messages (
    activity_id BIGINT NOT NULL,
    guest_id BIGINT NOT NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
    delivered BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (activity_id, guest_id),
    FOREIGN KEY (activity_id, guest_id)
        REFERENCES programme_werewolf_players(activity_id, guest_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX programme_werewolf_messages_delivered ON programme_werewolf_messages(activity_id) WHERE delivered;
