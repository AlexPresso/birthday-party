package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"
)

// Tests only use an explicitly supplied test database and a disposable schema.
func testDatabaseURL(t *testing.T) string {
	t.Helper()
	value := os.Getenv("TEST_DATABASE_URL")
	if value == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || !strings.HasSuffix(strings.TrimPrefix(u.Path, "/"), "_test") {
		t.Fatal("TEST_DATABASE_URL must be a PostgreSQL URL whose database name ends in _test")
	}
	db, err := sql.Open("pgx", value)
	if err != nil {
		t.Fatal(err)
	}
	var suffix [12]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		db.Close()
		t.Fatal(err)
	}
	schema := "test_" + hex.EncodeToString(suffix[:])
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := db.ExecContext(t.Context(), "CREATE SCHEMA "+quoted); err != nil {
		db.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec("DROP SCHEMA " + quoted + " CASCADE"); err != nil {
			t.Errorf("remove test schema: %v", err)
		}
		db.Close()
	})
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	return u.String()
}

func testDatabase(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", testDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestDatabaseConfigurationErrorsHideCredentials(t *testing.T) {
	for _, value := range []string{"", "postgres://guest:private-test-password%zz@localhost/birthday"} {
		db, err := openDatabase(t.Context(), value)
		if db != nil {
			db.Close()
			t.Fatal("invalid configuration opened a database")
		}
		if err == nil || strings.Contains(err.Error(), "private-test-password") {
			t.Fatalf("invalid or sensitive configuration error: %v", err)
		}
	}
}

func migrationFiles(t *testing.T) fstest.MapFS {
	t.Helper()
	files := fstest.MapFS{}
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		name := "migrations/" + entry.Name()
		body, err := fs.ReadFile(migrations, name)
		if err != nil {
			t.Fatal(err)
		}
		files[name] = &fstest.MapFile{Data: body}
	}
	return files
}

func TestMigrationsAreSerializedAndIdempotent(t *testing.T) {
	db := testDatabase(t)
	var tasks sync.WaitGroup
	errors := make(chan error, 4)
	for range 4 {
		tasks.Go(func() { errors <- migrate(context.Background(), db) })
	}
	tasks.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != len(migrationFiles(t)) {
		t.Fatalf("migration count=%d", count)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM party").Scan(&count); err != nil || count != 1 {
		t.Fatalf("singleton party count=%d error=%v", count, err)
	}
}

func TestMigrationsRejectChangedOrMissingHistory(t *testing.T) {
	for _, scenario := range []string{"changed file", "missing applied file", "missing history", "renamed file"} {
		t.Run(scenario, func(t *testing.T) {
			db := testDatabase(t)
			files := migrationFiles(t)
			if err := applyMigrations(t.Context(), db, files); err != nil {
				t.Fatal(err)
			}
			initial := "migrations/0001_baseline.sql"
			switch scenario {
			case "changed file":
				files[initial].Data = append(files[initial].Data, []byte("\n-- changed\n")...)
			case "missing applied file":
				delete(files, initial)
			case "missing history":
				if _, err := db.Exec("DELETE FROM schema_migrations WHERE version=1"); err != nil {
					t.Fatal(err)
				}
			case "renamed file":
				files["migrations/0001_renamed.sql"] = files[initial]
				delete(files, initial)
			}
			if err := applyMigrations(t.Context(), db, files); err == nil {
				t.Fatal("invalid migration history was accepted")
			}
		})
	}
}

func TestMigrationsRollBackFailedChangesAndNormalizeLineEndings(t *testing.T) {
	db := testDatabase(t)
	files := migrationFiles(t)
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		file.Data = []byte(strings.ReplaceAll(strings.ReplaceAll(string(file.Data), "\r\n", "\n"), "\n", "\r\n"))
	}
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatalf("line endings changed checksum: %v", err)
	}
	version := len(files) + 1
	name := fmt.Sprintf("migrations/%04d_failure.sql", version)
	files[name] = &fstest.MapFile{Data: []byte("CREATE TABLE failed_change(id INT); SELECT missing_column FROM failed_change;")}
	if err := applyMigrations(t.Context(), db, files); err == nil {
		t.Fatal("invalid SQL was accepted")
	}
	var exists bool
	if err := db.QueryRow("SELECT to_regclass('failed_change') IS NOT NULL").Scan(&exists); err != nil || exists {
		t.Fatalf("failed migration retained a table: exists=%t error=%v", exists, err)
	}
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&exists); err != nil || exists {
		t.Fatalf("failed migration was recorded: exists=%t error=%v", exists, err)
	}
	files[name].Data = []byte("CREATE TABLE successful_change(id INT);")
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatalf("valid new migration failed: %v", err)
	}
}
