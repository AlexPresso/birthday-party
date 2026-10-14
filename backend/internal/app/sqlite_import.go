package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // Only used to read the previous database during import.
)

const sqliteImportSource = "birthday.sqlite"

func importSQLite(ctx context.Context, destination *sql.DB, dataDir string) error {
	path, err := filepath.Abs(filepath.Join(dataDir, sqliteImportSource))
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("birthday.sqlite must be a regular file")
	}
	tx, err := destination.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, startupLock); err != nil {
		return err
	}
	var completed bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM data_imports WHERE source=$1)", sqliteImportSource).Scan(&completed); err != nil {
		return err
	}
	if completed {
		return nil
	}
	// Prevent writes while deciding whether the destination can safely receive legacy data.
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests,invitations,sessions,party,events,entries,photos IN EXCLUSIVE MODE"); err != nil {
		return err
	}
	var occupied bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM guests)
		OR EXISTS(SELECT 1 FROM invitations) OR EXISTS(SELECT 1 FROM sessions)
		OR EXISTS(SELECT 1 FROM events) OR EXISTS(SELECT 1 FROM entries) OR EXISTS(SELECT 1 FROM photos)
		OR EXISTS(SELECT 1 FROM party WHERE title<>'' OR timezone<>'Europe/Zurich' OR date IS NOT NULL OR location<>'')`).Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return errors.New("PostgreSQL already contains application data and birthday.sqlite has not been imported; use an empty destination or explicitly resolve the two datasets")
	}
	filePath := filepath.ToSlash(path)
	if !strings.HasPrefix(filePath, "/") {
		filePath = "/" + filePath
	}
	sourceURL := url.URL{Scheme: "file", Path: filePath, RawQuery: "mode=ro&_pragma=query_only(1)"}
	source, err := sql.Open("sqlite", sourceURL.String())
	if err != nil {
		return err
	}
	defer source.Close()
	source.SetMaxOpenConns(1)
	// One read transaction gives every table the same SQLite snapshot, including WAL data.
	read, err := source.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer read.Rollback()
	var version int
	if err := read.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version < 1 || version > 2 {
		return fmt.Errorf("unsupported SQLite schema version %d; expected 1 or 2", version)
	}
	var integrity string
	if err := read.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return errors.New("SQLite integrity check failed; restore a valid backup before importing")
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM party"); err != nil {
		return err
	}
	for _, table := range []struct{ name, columns, sourceColumns string }{
		{"guests", "id,name,role,active", ""},
		{"invitations", "token_hash,guest_id,expires_at,used_at", ""},
		{"sessions", "token_hash,guest_id,created_at,expires_at", ""},
		{"party", "id,title,timezone,date,location", ""},
		{"events", "id,title,description,teaser,starts_at,unlock_at", ""},
		{"entries", "id,guest_id,body,created_at,anonymous", legacyEntryColumns(version)},
		{"photos", "id,guest_id,width,height,created_at,filename,thumbnail,mime,byte_size", ""},
	} {
		if err := copySQLiteTable(ctx, read, tx, table.name, table.columns, table.sourceColumns); err != nil {
			return fmt.Errorf("copy %s: %w", table.name, err)
		}
	}
	var parties int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM party").Scan(&parties); err != nil {
		return err
	}
	if parties != 1 {
		return errors.New("SQLite must contain exactly one party record")
	}
	for _, table := range []string{"guests", "events", "entries", "photos"} {
		var previous int64
		err := read.QueryRowContext(ctx, "SELECT seq FROM sqlite_sequence WHERE name=?", table).Scan(&previous)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var highest int64
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(id),0) FROM "+table).Scan(&highest); err != nil {
			return err
		}
		highest = max(previous, highest)
		if _, err := tx.ExecContext(ctx, "SELECT setval(pg_get_serial_sequence($1,'id'),$2,$3)", table, max(highest, 1), highest > 0); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO data_imports(source) VALUES($1)", sqliteImportSource); err != nil {
		return err
	}
	return tx.Commit()
}

func legacyEntryColumns(version int) string {
	if version == 1 {
		return "id,guest_id,body,created_at,0"
	}
	return "id,guest_id,body,created_at,anonymous"
}

func copySQLiteTable(ctx context.Context, source, destination *sql.Tx, table, columns, sourceColumns string) error {
	if sourceColumns == "" {
		sourceColumns = columns
	}
	// All identifiers come from the fixed table definitions above, never input data.
	rows, err := source.QueryContext(ctx, "SELECT "+sourceColumns+" FROM "+table)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := len(strings.Split(columns, ","))
	values, targets, parameters := make([]any, count), make([]any, count), make([]string, count)
	for index := range values {
		targets[index] = &values[index]
		parameters[index] = "$" + strconv.Itoa(index+1)
	}
	statement, err := destination.PrepareContext(ctx, "INSERT INTO "+table+"("+columns+") VALUES("+strings.Join(parameters, ",")+")")
	if err != nil {
		return err
	}
	defer statement.Close()
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return err
		}
		if _, err := statement.ExecContext(ctx, values...); err != nil {
			return err
		}
	}
	return rows.Err()
}
