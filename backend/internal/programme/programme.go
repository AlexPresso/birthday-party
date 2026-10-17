// Package programme owns scheduled events, validation and reveal rules.
package programme

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidEvent = errors.New("invalid event")
	ErrInvalidDate  = errors.New("invalid event date")
	ErrLimitReached = errors.New("event limit reached")
	ErrNotFound     = errors.New("event not found")
)

// Event contains the fields visible to its requested audience.
type Event struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Teaser      string  `json:"teaser"`
	StartsAt    *string `json:"startsAt"`
	UnlockAt    *string `json:"unlockAt"`
	Locked      bool    `json:"locked"`
}

// Input is the host-authored event content before normalization and validation.
type Input struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Teaser      string  `json:"teaser"`
	StartsAt    *string `json:"startsAt"`
	UnlockAt    *string `json:"unlockAt"`
}

func (input Input) normalize() (Input, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Teaser = strings.TrimSpace(input.Teaser)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 160 || utf8.RuneCountInString(input.Description) > 4000 || utf8.RuneCountInString(input.Teaser) > 160 {
		return input, ErrInvalidEvent
	}
	for _, value := range []**string{&input.StartsAt, &input.UnlockAt} {
		if *value == nil {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, **value)
		if err != nil || parsed.Year() < 2000 || parsed.Year() > 2200 {
			return input, ErrInvalidDate
		}
		normalized := parsed.UTC().Format(time.RFC3339Nano)
		*value = &normalized
	}
	return input, nil
}

func (input Input) event(id int64) Event {
	return Event{ID: id, Title: input.Title, Description: input.Description, Teaser: input.Teaser, StartsAt: input.StartsAt, UnlockAt: input.UnlockAt}
}

// View hides unrevealed content from guests. Invalid stored timestamps fail closed.
func (event Event) View(now time.Time, private bool) Event {
	if event.UnlockAt != nil {
		unlock, err := time.Parse(time.RFC3339Nano, *event.UnlockAt)
		event.Locked = err != nil || now.Before(unlock)
	}
	if event.Locked && !private {
		event.Title = event.Teaser
		event.Description = ""
	}
	return event
}

// Repository stores authored events without applying audience-specific reveal rules.
type Repository interface {
	List(context.Context, int) ([]Event, error)
	UnlockTimes(context.Context, int) ([]string, error)
	Create(context.Context, Input, int) (int64, error)
	Update(context.Context, int64, Input) error
	Delete(context.Context, int64) error
}

const eventLimit = 200

// Service validates event changes and controls when authored content becomes visible.
type Service struct{ repository Repository }

// New uses the supplied persistence port without starting background work.
func New(repository Repository) *Service { return &Service{repository: repository} }

// List orders the bounded programme by start time and applies reveal rules.
func (s *Service) List(ctx context.Context, clock func() time.Time, private bool) ([]Event, error) {
	records, err := s.repository.List(ctx, eventLimit)
	if err != nil {
		return nil, err
	}
	now := clock()
	items := make([]Event, 0, len(records))
	for _, event := range records {
		items = append(items, event.View(now, private))
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].StartsAt == nil {
			return false
		}
		if items[j].StartsAt == nil {
			return true
		}
		left, _ := time.Parse(time.RFC3339Nano, *items[i].StartsAt)
		right, _ := time.Parse(time.RFC3339Nano, *items[j].StartsAt)
		if left.Equal(right) {
			return items[i].ID < items[j].ID
		}
		return left.Before(right)
	})
	return items, nil
}

// Create validates an event and enforces the collection limit transactionally.
func (s *Service) Create(ctx context.Context, input Input) (Event, error) {
	input, err := input.normalize()
	if err != nil {
		return Event{}, err
	}
	id, err := s.repository.Create(ctx, input, eventLimit)
	if err != nil {
		return Event{}, err
	}
	return input.event(id), nil
}

// Update replaces the host-authored fields of an existing event.
func (s *Service) Update(ctx context.Context, id int64, input Input) (Event, error) {
	input, err := input.normalize()
	if err != nil {
		return Event{}, err
	}
	if err := s.repository.Update(ctx, id, input); err != nil {
		return Event{}, err
	}
	return input.event(id), nil
}

// Delete removes an event, returning ErrNotFound when it is absent.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.repository.Delete(ctx, id)
}

// NextUnlock ignores malformed legacy times, matching View's fail-closed rule.
func (s *Service) NextUnlock(ctx context.Context, now time.Time) (time.Time, error) {
	times, err := s.repository.UnlockTimes(ctx, eventLimit)
	if err != nil {
		return time.Time{}, err
	}
	var next time.Time
	for _, value := range times {
		unlock, err := time.Parse(time.RFC3339Nano, value)
		if err == nil && unlock.After(now) && (next.IsZero() || unlock.Before(next)) {
			next = unlock
		}
	}
	return next, nil
}
