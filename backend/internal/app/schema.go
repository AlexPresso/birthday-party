package app

import (
	"database/sql"
	"fmt"
)

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > 2 {
		return fmt.Errorf("database version %d is newer than this application", version)
	}
	if version == 2 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if version < 1 {
		if _, err := tx.Exec(schema); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("ALTER TABLE entries ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1))"); err != nil {
		return err
	}
	if _, err := tx.Exec("PRAGMA user_version=2"); err != nil {
		return err
	}
	return tx.Commit()
}

const schema = `
CREATE TABLE IF NOT EXISTS guests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('guest','admin')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS invitations (
 token_hash TEXT PRIMARY KEY, guest_id INTEGER NOT NULL REFERENCES guests(id),
 expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS invitations_guest ON invitations(guest_id);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, guest_id INTEGER NOT NULL REFERENCES guests(id),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_guest ON sessions(guest_id);
CREATE TABLE IF NOT EXISTS party (
 id INTEGER PRIMARY KEY CHECK(id=1), title TEXT NOT NULL, timezone TEXT NOT NULL,
 date TEXT, location TEXT NOT NULL
);
INSERT OR IGNORE INTO party(id,title,timezone,date,location) VALUES(1,'','Europe/Zurich',NULL,'');
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL,
 teaser TEXT NOT NULL, starts_at TEXT, unlock_at TEXT
);
CREATE TABLE IF NOT EXISTS entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id INTEGER NOT NULL REFERENCES guests(id),
 body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id INTEGER NOT NULL REFERENCES guests(id),
 width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL,
 filename TEXT NOT NULL, thumbnail TEXT NOT NULL, mime TEXT NOT NULL,
 byte_size INTEGER NOT NULL
);
`
