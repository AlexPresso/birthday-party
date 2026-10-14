CREATE TABLE upload_jobs (
 id BIGSERIAL PRIMARY KEY,
 guest_id BIGINT NOT NULL REFERENCES guests(id),
 client_upload_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','processing','ready','failed')),
 filename TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('image','video')),
 input_format TEXT NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,
 byte_size BIGINT NOT NULL CHECK(byte_size >= 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 error_code TEXT,
 photo_id BIGINT REFERENCES photos(id) ON DELETE SET NULL,
 UNIQUE(guest_id,client_upload_id)
);
CREATE INDEX upload_jobs_pending ON upload_jobs(id) WHERE status IN ('queued','processing');
CREATE INDEX upload_jobs_guest ON upload_jobs(guest_id,id DESC);
