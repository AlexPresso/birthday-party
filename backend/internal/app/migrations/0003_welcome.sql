CREATE TABLE welcome (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_step SMALLINT NOT NULL DEFAULT 0,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    CHECK (jsonb_typeof(steps) = 'array'),
    CHECK (jsonb_array_length(steps) <= 12),
    CHECK (current_step >= 0 AND current_step <= jsonb_array_length(steps)),
    CHECK (NOT is_open OR current_step = 0)
);

-- Existing parties remain accessible until the host starts the welcome sequence.
INSERT INTO welcome(id) VALUES (1);
