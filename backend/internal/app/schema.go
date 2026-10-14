package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Both startup operations use the same transaction-scoped lock within each schema.
const startupLock = `SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema() || ':birthday-startup', 0))`

func migrate(ctx context.Context, db *sql.DB) error {
	return applyMigrations(ctx, db, migrations)
}

func applyMigrations(ctx context.Context, db *sql.DB, files fs.FS) error {
	entries, err := fs.ReadDir(files, "migrations")
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, startupLock); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return err
	}
	type appliedMigration struct{ name, checksum string }
	applied := make(map[int]appliedMigration)
	rows, err := tx.QueryContext(ctx, "SELECT version,name,checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return err
	}
	for rows.Next() {
		var version int
		var record appliedMigration
		if err := rows.Scan(&version, &record.name, &record.checksum); err != nil {
			rows.Close()
			return err
		}
		applied[version] = record
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for index, entry := range entries {
		name := entry.Name()
		prefix, _, found := strings.Cut(name, "_")
		version, err := strconv.Atoi(prefix)
		if err != nil || !found || len(prefix) != 4 || entry.IsDir() || !strings.HasSuffix(name, ".sql") || version != index+1 {
			return fmt.Errorf("invalid or nonsequential migration filename %q", name)
		}
		body, err := fs.ReadFile(files, "migrations/"+name)
		if err != nil {
			return err
		}
		// Git checkouts can use CRLF; the SQL and its checksum are platform independent.
		statement := strings.ReplaceAll(string(body), "\r\n", "\n")
		checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(statement)))
		if record, exists := applied[version]; exists {
			if record.name != name || record.checksum != checksum {
				return fmt.Errorf("applied migration %04d has changed; restore it and add a new migration", version)
			}
			delete(applied, version)
			continue
		}
		for recordedVersion := range applied {
			if recordedVersion > version {
				return fmt.Errorf("migration history is missing version %04d", version)
			}
		}
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)", version, name, checksum); err != nil {
			return err
		}
	}
	if len(applied) != 0 {
		return fmt.Errorf("database contains migrations unknown to this application")
	}
	return tx.Commit()
}
