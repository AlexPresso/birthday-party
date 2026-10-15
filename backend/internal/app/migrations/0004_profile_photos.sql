-- Small normalized avatars stay with guest records so replacement and removal are atomic.
ALTER TABLE guests
    ADD COLUMN avatar_jpeg BYTEA CHECK (octet_length(avatar_jpeg) BETWEEN 1 AND 131072),
    ADD COLUMN avatar_version BIGINT NOT NULL DEFAULT 0 CHECK (avatar_version >= 0),
    ADD CONSTRAINT avatar_requires_version CHECK (avatar_jpeg IS NULL OR avatar_version > 0);
