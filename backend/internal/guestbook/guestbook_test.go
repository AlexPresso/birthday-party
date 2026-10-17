package guestbook

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"birthday-party/backend/internal/identity"
)

type memoryEntries struct {
	items          []Record
	requestedLimit int
	deleted        bool
}

func (repository *memoryEntries) List(_ context.Context, _ int64, limit int) ([]Record, error) {
	repository.requestedLimit = limit
	return repository.items, nil
}

func (repository *memoryEntries) Create(_ context.Context, record Record) (int64, error) {
	record.ID = int64(len(repository.items) + 1)
	repository.items = append(repository.items, record)
	return record.ID, nil
}

func (repository *memoryEntries) Owner(_ context.Context, id int64) (int64, error) {
	for _, record := range repository.items {
		if record.ID == id {
			return record.Author.ID, nil
		}
	}
	return 0, ErrNotFound
}

func (repository *memoryEntries) Delete(_ context.Context, _ int64) (bool, error) {
	repository.deleted = true
	return true, nil
}

func TestServiceNeverRevealsAnonymousOwner(t *testing.T) {
	avatar := "/api/guests/17/avatar?v=2"
	owner := identity.Author{ID: 17, Name: "Private owner", AvatarURL: &avatar}
	repository := &memoryEntries{items: []Record{{ID: 1, Author: owner, Anonymous: true, Body: "A message"}, {ID: 2, Author: owner, Body: "Signed message"}}}
	service := New(repository)
	for _, test := range []struct {
		name      string
		viewer    identity.Guest
		canDelete bool
	}{
		{"owner", identity.Guest{ID: 17, Role: "guest"}, true},
		{"administrator", identity.Guest{ID: 1, Role: "admin"}, true},
		{"another guest", identity.Guest{ID: 22, Role: "guest"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			entries, err := service.List(t.Context(), test.viewer, 0, 500)
			if err != nil {
				t.Fatal(err)
			}
			if entries[0].Author != nil || entries[0].CanDelete != test.canDelete {
				t.Fatalf("anonymous view = %+v", entries[0])
			}
			encoded, err := json.Marshal(entries[0])
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), owner.Name) || strings.Contains(string(encoded), avatar) {
				t.Fatal("anonymous response exposed owner details")
			}
			if entries[1].Author == nil || *entries[1].Author.AvatarURL != avatar {
				t.Fatal("named attribution lost the avatar")
			}
			if repository.requestedLimit != 49 {
				t.Fatalf("query limit = %d, want 49", repository.requestedLimit)
			}
		})
	}
}

func TestServiceValidatesMessagesBeforePersistence(t *testing.T) {
	repository := &memoryEntries{}
	service := New(repository)
	viewer := identity.Guest{ID: 17, Name: "Private owner", Role: "guest"}
	now := time.Date(2026, 10, 17, 19, 0, 0, 0, time.FixedZone("local", 7200))
	for _, body := range []string{" \n\t", strings.Repeat("é", 2001)} {
		if _, err := service.Create(t.Context(), viewer, body, true, now); !errors.Is(err, ErrInvalidMessage) {
			t.Fatalf("error = %v, want invalid message", err)
		}
	}
	if len(repository.items) != 0 {
		t.Fatal("invalid messages reached persistence")
	}
	entry, err := service.Create(t.Context(), viewer, "  "+strings.Repeat("é", 2000)+"  ", true, now)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Author != nil || !entry.CanDelete || entry.CreatedAt != "2026-10-17T17:00:00Z" {
		t.Fatalf("created view = %+v", entry)
	}
	if repository.items[0].Author.ID != viewer.ID || repository.items[0].Body != strings.Repeat("é", 2000) {
		t.Fatal("private persistence lost the owner or trimmed message")
	}
}

func TestServiceEnforcesDeletionBeforeCallingPersistence(t *testing.T) {
	for _, test := range []struct {
		name   string
		viewer identity.Guest
		want   error
	}{
		{"owner", identity.Guest{ID: 17, Role: "guest"}, nil},
		{"administrator", identity.Guest{ID: 1, Role: "admin"}, nil},
		{"another guest", identity.Guest{ID: 22, Role: "guest"}, ErrDeleteForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &memoryEntries{items: []Record{{ID: 1, Author: identity.Author{ID: 17}, Anonymous: true}}}
			deleted, err := New(repository).Delete(t.Context(), 1, test.viewer)
			if !errors.Is(err, test.want) || deleted != (test.want == nil) || repository.deleted != deleted {
				t.Fatalf("deleted=%v persisted=%v error=%v", deleted, repository.deleted, err)
			}
		})
	}
	if _, err := New(&memoryEntries{}).Delete(t.Context(), 99, identity.Guest{Role: "admin"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing entry error=%v", err)
	}
}
