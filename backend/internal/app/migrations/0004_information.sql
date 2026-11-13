-- Information page ---------------------------------------------------------------
--
-- One page of titled texts written by the host. It stays hidden until the host
-- turns it on; the revision keeps two hosts from overwriting each other.

CREATE TABLE information (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT information_tabs_bounded CHECK (jsonb_typeof(tabs) = 'array' AND jsonb_array_length(tabs) <= 8)
);
INSERT INTO information(id) VALUES (1);
