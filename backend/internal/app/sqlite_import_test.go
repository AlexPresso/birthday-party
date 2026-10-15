package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const legacySchema = `
CREATE TABLE guests(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE invitations(token_hash TEXT PRIMARY KEY,guest_id INTEGER NOT NULL REFERENCES guests(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,guest_id INTEGER NOT NULL REFERENCES guests(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE party(id INTEGER PRIMARY KEY,title TEXT NOT NULL,timezone TEXT NOT NULL,date TEXT,location TEXT NOT NULL);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,description TEXT NOT NULL,teaser TEXT NOT NULL,starts_at TEXT,unlock_at TEXT);
CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,guest_id INTEGER NOT NULL REFERENCES guests(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE photos(id INTEGER PRIMARY KEY AUTOINCREMENT,guest_id INTEGER NOT NULL REFERENCES guests(id),width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL,filename TEXT NOT NULL,thumbnail TEXT NOT NULL,mime TEXT NOT NULL,byte_size INTEGER NOT NULL);
PRAGMA user_version=1;
`

type sqliteFixture struct {
	db              *sql.DB
	dir             string
	sessionToken    string
	invitationToken string
}

func legacyDatabase(t *testing.T, version int) sqliteFixture {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, sqliteImportSource))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	// Keep committed data in WAL to verify that import reads a complete snapshot.
	if _, err := db.Exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;" + legacySchema); err != nil {
		t.Fatal(err)
	}
	if version == 2 {
		if _, err := db.Exec("ALTER TABLE entries ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1)); PRAGMA user_version=2;"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
INSERT INTO guests(id,name,role,active) VALUES(7,'Existing guest','guest',1),(8,'Existing host','admin',1),(9,'Revoked guest','guest',0),(99,'Deleted guest','guest',0);
DELETE FROM guests WHERE id=99;
INSERT INTO party(id,title,timezone,date,location) VALUES(1,'Existing birthday','Europe/Zurich','2026-11-23T17:00:00Z','Existing venue');
INSERT INTO events(id,title,description,teaser,starts_at,unlock_at) VALUES(12,'Private surprise','Existing description','Existing teaser','2026-11-23T19:00:00Z','2026-11-23T18:00:00Z'),(119,'Deleted event','','',NULL,NULL);
DELETE FROM events WHERE id=119;
INSERT INTO entries(id,guest_id,body,created_at) VALUES(21,7,'Existing message','2026-10-14T12:00:00Z'),(109,7,'Deleted message','2026-10-14T12:00:00Z');
DELETE FROM entries WHERE id=109;
INSERT INTO photos(id,guest_id,width,height,created_at,filename,thumbnail,mime,byte_size) VALUES
(31,7,80,60,'2026-10-14T12:00:00Z','legacy-image.jpg','legacy-image-thumb.jpg','image/jpeg',1234),
(32,7,160,90,'2026-10-14T12:00:00Z','legacy-video.mp4','legacy-video-thumb.jpg','video/mp4',5678),
(129,7,80,60,'2026-10-14T12:00:00Z','deleted.jpg','deleted-thumb.jpg','image/jpeg',100);
DELETE FROM photos WHERE id=129;
`); err != nil {
		t.Fatal(err)
	}
	if version == 2 {
		if _, err := db.Exec("UPDATE entries SET anonymous=1 WHERE id=21"); err != nil {
			t.Fatal(err)
		}
	}
	session, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO sessions(token_hash,guest_id,created_at,expires_at) VALUES(?,7,1791979200,1893456000)", hashToken(session)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO invitations(token_hash,guest_id,expires_at) VALUES(?,7,1893456000)", hashToken(invitation)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO invitations(token_hash,guest_id,expires_at,used_at) VALUES('previously-used',8,1893456000,1791979200)"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "photos"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"legacy-image.jpg", "legacy-image-thumb.jpg", "legacy-video.mp4", "legacy-video-thumb.jpg"} {
		if err := os.WriteFile(filepath.Join(dir, "photos", name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return sqliteFixture{db: db, dir: dir, sessionToken: session, invitationToken: invitation}
}

func TestSQLiteImportPreservesDataAndCredentials(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(string(rune('0'+version)), func(t *testing.T) {
			fixture := legacyDatabase(t, version)
			before, err := os.ReadFile(filepath.Join(fixture.dir, sqliteImportSource))
			if err != nil {
				t.Fatal(err)
			}
			a, err := Open(Config{PublicURL: "http://localhost:3000", DataDir: fixture.dir, DatabaseURL: testDatabaseURL(t)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { a.Close() })
			a.now = func() time.Time { return time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC) }
			cookie := &http.Cookie{Name: cookieName, Value: fixture.sessionToken}
			status(t, request(t, a, "GET", "/api/session", nil, cookie), http.StatusOK)
			status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": fixture.invitationToken}, nil), http.StatusOK)
			entries := request(t, a, "GET", "/api/guestbook", nil, cookie)
			status(t, entries, http.StatusOK)
			var page struct{ Items []Entry }
			if err := json.Unmarshal(entries.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != 1 || page.Items[0].ID != 21 || page.Items[0].Body != "Existing message" || page.Items[0].Anonymous != (version == 2) || !page.Items[0].CanDelete {
				t.Fatalf("guestbook data changed: %s", entries.Body.String())
			}
			if version == 2 {
				assertAnonymousEntry(t, mustJSON(t, page.Items[0]), "Existing guest")
			} else if page.Items[0].Author == nil || page.Items[0].Author.ID != 7 {
				t.Fatal("named entry lost its owner")
			}
			var title, timezone, date, location string
			if err := a.db.QueryRow("SELECT title,timezone,date,location FROM party").Scan(&title, &timezone, &date, &location); err != nil {
				t.Fatal(err)
			}
			if title != "Existing birthday" || timezone != "Europe/Zurich" || date != "2026-11-23T17:00:00Z" || location != "Existing venue" {
				t.Fatal("party data changed during import")
			}
			var description, teaser, startsAt, unlockAt string
			if err := a.db.QueryRow("SELECT description,teaser,starts_at,unlock_at FROM events WHERE id=12").Scan(&description, &teaser, &startsAt, &unlockAt); err != nil {
				t.Fatal(err)
			}
			if description != "Existing description" || teaser != "Existing teaser" || startsAt != "2026-11-23T19:00:00Z" || unlockAt != "2026-11-23T18:00:00Z" {
				t.Fatal("scheduled event changed during import")
			}
			var active bool
			if err := a.db.QueryRow("SELECT active FROM guests WHERE id=9").Scan(&active); err != nil || active {
				t.Fatalf("revoked guest was reactivated: %v", err)
			}
			var used int64
			if err := a.db.QueryRow("SELECT used_at FROM invitations WHERE token_hash='previously-used'").Scan(&used); err != nil || used != 1791979200 {
				t.Fatalf("used invitation changed: %v", err)
			}
			media := request(t, a, "GET", "/api/photos", nil, cookie)
			status(t, media, http.StatusOK)
			if !strings.Contains(media.Body.String(), `"kind":"video"`) || !strings.Contains(media.Body.String(), `"kind":"image"`) {
				t.Fatalf("media references were lost: %s", media.Body.String())
			}
			for _, name := range []string{"legacy-image.jpg", "legacy-image-thumb.jpg", "legacy-video.mp4", "legacy-video-thumb.jpg"} {
				data, err := os.ReadFile(filepath.Join(fixture.dir, "photos", name))
				if err != nil || string(data) != name {
					t.Fatalf("media file changed: %s: %v", name, err)
				}
			}
			for _, sequence := range []struct {
				table string
				want  int64
			}{{"guests", 100}, {"events", 120}, {"entries", 110}, {"photos", 130}} {
				var next int64
				if err := a.db.QueryRow("SELECT nextval(pg_get_serial_sequence($1,'id'))", sequence.table).Scan(&next); err != nil || next != sequence.want {
					t.Fatalf("%s next ID=%d want=%d error=%v", sequence.table, next, sequence.want, err)
				}
			}
			if _, err := a.db.Exec("UPDATE party SET title='Updated after import'"); err != nil {
				t.Fatal(err)
			}
			if err := importSQLite(t.Context(), a.db, fixture.dir); err != nil {
				t.Fatalf("second import was not a no-op: %v", err)
			}
			if err := a.db.QueryRow("SELECT title FROM party").Scan(&title); err != nil || title != "Updated after import" {
				t.Fatal("second import overwrote PostgreSQL data")
			}
			after, err := os.ReadFile(filepath.Join(fixture.dir, sqliteImportSource))
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("legacy SQLite file was modified")
			}
			var storedVersion int
			if err := fixture.db.QueryRow("PRAGMA user_version").Scan(&storedVersion); err != nil || storedVersion != version {
				t.Fatal("legacy SQLite schema was modified")
			}
		})
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSQLiteImportRefusesAmbiguousOrInvalidData(t *testing.T) {
	for _, scenario := range []string{"occupied destination", "unknown version", "invalid reference"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := legacyDatabase(t, 2)
			db := testDatabase(t)
			if err := migrate(t.Context(), db); err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "occupied destination":
				if _, err := db.Exec("UPDATE party SET title='Existing PostgreSQL party'"); err != nil {
					t.Fatal(err)
				}
			case "unknown version":
				if _, err := fixture.db.Exec("PRAGMA user_version=3"); err != nil {
					t.Fatal(err)
				}
			case "invalid reference":
				if _, err := fixture.db.Exec("UPDATE entries SET guest_id=9999"); err != nil {
					t.Fatal(err)
				}
			}
			if err := importSQLite(t.Context(), db, fixture.dir); err == nil {
				t.Fatal("unsafe import was accepted")
			}
			var count int
			if err := db.QueryRow("SELECT (SELECT COUNT(*) FROM guests)+(SELECT COUNT(*) FROM data_imports)").Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed import retained partial data: count=%d error=%v", count, err)
			}
			if scenario == "invalid reference" {
				if _, err := fixture.db.Exec("UPDATE entries SET guest_id=7"); err != nil {
					t.Fatal(err)
				}
				if err := importSQLite(t.Context(), db, fixture.dir); err != nil {
					t.Fatalf("corrected import could not resume: %v", err)
				}
			}
		})
	}
}
