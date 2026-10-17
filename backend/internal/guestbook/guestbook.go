// Package guestbook owns messages, anonymous attribution and deletion permissions.
package guestbook

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"birthday-party/backend/internal/identity"
)

var (
	ErrInvalidMessage  = errors.New("message must contain 1–2000 characters")
	ErrNotFound        = errors.New("message not found")
	ErrDeleteForbidden = errors.New("message deletion is not permitted")
)

// Entry omits its owner entirely when anonymous, including for administrators.
type Entry struct {
	ID        int64            `json:"id"`
	Author    *identity.Author `json:"author"`
	Anonymous bool             `json:"anonymous"`
	CanDelete bool             `json:"canDelete"`
	Body      string           `json:"body"`
	CreatedAt string           `json:"createdAt"`
}

// Record is private persistence data. Only Entry may be returned to a viewer.
type Record struct {
	ID        int64
	Author    identity.Author
	Anonymous bool
	Body      string
	CreatedAt string
}

// Repository persists entries and retains their owners for permission checks.
type Repository interface {
	List(context.Context, int64, int) ([]Record, error)
	Create(context.Context, Record) (int64, error)
	Owner(context.Context, int64) (int64, error)
	Delete(context.Context, int64) (bool, error)
}

// Service enforces message validation, anonymous attribution and deletion rules.
type Service struct{ repository Repository }

// New uses the supplied persistence port without starting background work.
func New(repository Repository) *Service { return &Service{repository: repository} }

// List returns a bounded page plus one entry for cursor pagination.
func (s *Service) List(ctx context.Context, viewer identity.Guest, before int64, limit int) ([]Entry, error) {
	records, err := s.repository.List(ctx, before, min(max(limit, 1), 48)+1)
	if err != nil {
		return nil, err
	}
	items := make([]Entry, 0, len(records))
	for _, record := range records {
		items = append(items, record.view(viewer))
	}
	return items, nil
}

func (record Record) view(viewer identity.Guest) Entry {
	entry := Entry{ID: record.ID, Anonymous: record.Anonymous, Body: record.Body, CreatedAt: record.CreatedAt,
		CanDelete: viewer.Role == "admin" || viewer.ID == record.Author.ID}
	if !record.Anonymous {
		entry.Author = &record.Author
	}
	return entry
}

// Create stores the owner for permissions without exposing anonymous attribution.
func (s *Service) Create(ctx context.Context, viewer identity.Guest, body string, anonymous bool, now time.Time) (Entry, error) {
	body = strings.TrimSpace(body)
	if length := utf8.RuneCountInString(body); length < 1 || length > 2000 {
		return Entry{}, ErrInvalidMessage
	}
	record := Record{Author: identity.Author{ID: viewer.ID, Name: viewer.Name, AvatarURL: viewer.AvatarURL},
		Anonymous: anonymous, Body: body, CreatedAt: now.UTC().Format(time.RFC3339Nano)}
	var err error
	record.ID, err = s.repository.Create(ctx, record)
	if err != nil {
		return Entry{}, err
	}
	return record.view(viewer), nil
}

// Delete permits only the author or an administrator, regardless of anonymity.
// It returns false when another request deleted the entry after the permission check.
func (s *Service) Delete(ctx context.Context, id int64, viewer identity.Guest) (bool, error) {
	author, err := s.repository.Owner(ctx, id)
	if err != nil {
		return false, err
	}
	if viewer.Role != "admin" && viewer.ID != author {
		return false, ErrDeleteForbidden
	}
	return s.repository.Delete(ctx, id)
}
