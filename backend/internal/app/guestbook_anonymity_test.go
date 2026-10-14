package app

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func decodeEntry(t *testing.T, response *httptest.ResponseRecorder) Entry {
	t.Helper()
	var entry Entry
	if err := json.Unmarshal(response.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	return entry
}

func TestAnonymousGuestbookRedactsIdentityForEveryViewer(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, identity, _ := guest(t, a, host, "Anonymous author")
	other, _, _ := guest(t, a, host, "Other guest")
	created := request(t, a, "POST", "/api/guestbook", map[string]any{"body": "  A birthday message  ", "anonymous": true}, owner)
	status(t, created, http.StatusCreated)
	entry := decodeEntry(t, created)
	if !entry.Anonymous || entry.Author != nil || !entry.CanDelete || entry.Body != "A birthday message" {
		t.Fatalf("unexpected anonymous entry: %+v", entry)
	}
	assertAnonymousEntry(t, created.Body.Bytes(), identity.Name)

	var storedOwner int64
	if err := a.db.QueryRow("SELECT guest_id FROM entries WHERE id=?", entry.ID).Scan(&storedOwner); err != nil {
		t.Fatal(err)
	}
	if storedOwner != identity.ID {
		t.Fatal("anonymous entry must retain its private owner for authorization")
	}

	for _, viewer := range []struct {
		name      string
		cookie    *http.Cookie
		canDelete bool
	}{
		{"owner", owner, true},
		{"other guest", other, false},
		{"administrator", host, true},
	} {
		t.Run(viewer.name, func(t *testing.T) {
			response := request(t, a, "GET", "/api/guestbook", nil, viewer.cookie)
			status(t, response, http.StatusOK)
			var page struct {
				Items []json.RawMessage `json:"items"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != 1 {
				t.Fatalf("expected one entry, got %d", len(page.Items))
			}
			assertAnonymousEntry(t, page.Items[0], identity.Name)
			var listed Entry
			if err := json.Unmarshal(page.Items[0], &listed); err != nil {
				t.Fatal(err)
			}
			if listed.CanDelete != viewer.canDelete || listed.ID != entry.ID || listed.Body != entry.Body || listed.CreatedAt != entry.CreatedAt {
				t.Fatalf("unexpected anonymous entry for %s: %+v", viewer.name, listed)
			}
		})
	}
}

func assertAnonymousEntry(t *testing.T, raw []byte, ownerName string) {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["author"]) != "null" || string(fields["anonymous"]) != "true" || strings.Contains(string(raw), ownerName) {
		t.Fatalf("anonymous entry disclosed its author: %s", raw)
	}
	allowed := map[string]bool{"id": true, "author": true, "anonymous": true, "canDelete": true, "body": true, "createdAt": true}
	for field := range fields {
		if !allowed[field] {
			t.Fatalf("anonymous entry includes an unexpected field %q", field)
		}
	}
	if len(fields) != len(allowed) {
		t.Fatalf("incomplete anonymous entry: %s", raw)
	}
}

func TestGuestbookDeletionUsesPrivateOwnerForAnonymousEntries(t *testing.T) {
	for _, anonymous := range []bool{false, true} {
		t.Run(strconv.FormatBool(anonymous), func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			owner, _, _ := guest(t, a, host, "Entry owner")
			other, _, _ := guest(t, a, host, "Other guest")
			for _, deleter := range []*http.Cookie{owner, host} {
				created := request(t, a, "POST", "/api/guestbook", map[string]any{"body": "Birthday wishes", "anonymous": anonymous}, owner)
				status(t, created, http.StatusCreated)
				entry := decodeEntry(t, created)
				path := "/api/guestbook/" + strconv.FormatInt(entry.ID, 10)
				status(t, request(t, a, "DELETE", path, nil, other), http.StatusForbidden)
				status(t, request(t, a, "DELETE", path, nil, nil), http.StatusUnauthorized)
				status(t, request(t, a, "DELETE", path, nil, deleter), http.StatusNoContent)
				status(t, request(t, a, "DELETE", path, nil, owner), http.StatusNotFound)
			}
		})
	}
}

func TestGuestbookKeepsNamedPostingAsDefault(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, identity, _ := guest(t, a, host, "Named author")
	other, _, _ := guest(t, a, host, "Other guest")
	for _, input := range []map[string]any{
		{"body": "Named by default"},
		{"body": "Explicitly named", "anonymous": false},
	} {
		response := request(t, a, "POST", "/api/guestbook", input, owner)
		status(t, response, http.StatusCreated)
		entry := decodeEntry(t, response)
		if entry.Anonymous || entry.Author == nil || entry.Author.ID != identity.ID || entry.Author.Name != identity.Name || !entry.CanDelete {
			t.Fatalf("named entry changed identity: %+v", entry)
		}
	}
	response := request(t, a, "GET", "/api/guestbook", nil, other)
	status(t, response, http.StatusOK)
	var page struct {
		Items []Entry `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("expected two named entries, got %d", len(page.Items))
	}
	for _, entry := range page.Items {
		if entry.Anonymous || entry.Author == nil || entry.Author.ID != identity.ID || entry.Author.Name != identity.Name || entry.CanDelete {
			t.Fatalf("unexpected named entry for another guest: %+v", entry)
		}
	}
	status(t, request(t, a, "POST", "/api/guestbook", map[string]any{"body": "Message", "anonymous": "true"}, owner), http.StatusBadRequest)
	status(t, request(t, a, "POST", "/api/guestbook", map[string]any{"body": "Message", "anonymous": true, "guest_id": identity.ID}, other), http.StatusBadRequest)
}

func TestAnonymousGuestbookMigrationPreservesExistingEntries(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "previous.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO guests(id,name,role) VALUES(7,'Existing guest','guest');
		INSERT INTO entries(id,guest_id,body,created_at) VALUES(9,7,'Existing message','2026-10-14T12:00:00Z');
		PRAGMA user_version=1;
	`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := migrate(db); err != nil {
			t.Fatal(err)
		}
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Fatalf("schema version=%d want=2", version)
	}
	var owner int64
	var body, createdAt string
	var anonymous bool
	if err := db.QueryRow("SELECT guest_id,body,created_at,anonymous FROM entries WHERE id=9").Scan(&owner, &body, &createdAt, &anonymous); err != nil {
		t.Fatal(err)
	}
	if owner != 7 || body != "Existing message" || createdAt != "2026-10-14T12:00:00Z" || anonymous {
		t.Fatal("migration changed an existing message or its attribution")
	}
	if _, err := db.Exec("UPDATE entries SET anonymous=2 WHERE id=9"); err == nil {
		t.Fatal("anonymous column must reject invalid flags")
	}
	if _, err := db.Exec("UPDATE entries SET anonymous=NULL WHERE id=9"); err == nil {
		t.Fatal("anonymous column must reject null flags")
	}
}
