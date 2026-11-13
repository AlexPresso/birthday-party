// Package programme owns scheduled events, validation and reveal rules.
package programme

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"birthday-party/backend/internal/timestamp"
)

var (
	ErrInvalidEvent = errors.New("invalid event")
	ErrInvalidDate  = errors.New("invalid event date")
	ErrLimitReached = errors.New("event limit reached")
	ErrNotFound     = errors.New("event not found")
)

// EventType selects the activity attached to a programme event. It is fixed
// when the event is created.
type EventType string

const (
	TypeEvent     EventType = "event"
	TypeVote      EventType = "vote"
	TypeQuestions EventType = "questions"
)

// Event contains the fields visible to its requested audience.
type Event struct {
	ID          int64            `json:"id"`
	Type        EventType        `json:"type"`
	Revision    int64            `json:"revision"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Teaser      string           `json:"teaser"`
	StartsAt    *string          `json:"startsAt"`
	UnlockAt    *string          `json:"unlockAt"`
	Locked      bool             `json:"locked"`
	Vote        *Vote            `json:"vote"`
	Questions   *QuestionSummary `json:"questions"`
}

// Input is the host-authored event content. After normalization its instants
// are valid UTC timestamps in the API form.
type Input struct {
	Type        EventType  `json:"type"`
	Revision    int64      `json:"revision"`
	Vote        *VoteInput `json:"vote"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Teaser      string     `json:"teaser"`
	StartsAt    *string    `json:"startsAt"`
	UnlockAt    *string    `json:"unlockAt"`
}

func (input Input) normalize() (Input, error) {
	switch input.Type {
	case "", TypeEvent, TypeVote, TypeQuestions:
	default:
		return input, ErrInvalidEvent
	}
	if (input.Type == TypeEvent || input.Type == TypeQuestions) && input.Vote != nil || input.Type == TypeVote && input.Vote == nil {
		return input, ErrInvalidEvent
	}
	if input.Vote != nil {
		vote, err := input.Vote.normalize()
		if err != nil {
			return input, err
		}
		input.Vote = &vote
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Teaser = strings.TrimSpace(input.Teaser)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 160 || utf8.RuneCountInString(input.Description) > 4000 || utf8.RuneCountInString(input.Teaser) > 160 {
		return input, ErrInvalidEvent
	}
	var valid bool
	if input.StartsAt, valid = timestamp.Normalize(input.StartsAt); !valid {
		return input, ErrInvalidDate
	}
	if input.UnlockAt, valid = timestamp.Normalize(input.UnlockAt); !valid {
		return input, ErrInvalidDate
	}
	return input, nil
}

// View hides unrevealed content from guests. An unreadable unlock time fails closed.
func (event Event) View(now time.Time, private bool) Event {
	if event.UnlockAt != nil {
		unlock, err := timestamp.Parse(*event.UnlockAt)
		event.Locked = err != nil || now.Before(unlock)
	}
	if event.Locked && !private {
		event.Title = event.Teaser
		event.Description = ""
		event.Vote = nil
		event.Questions = nil
	}
	return event
}

// Repository returns audience views from one snapshot and owns complete writes,
// including current authorization and persistence of each event's vote settings.
type Repository interface {
	List(context.Context, int, int64, bool, time.Time) ([]Event, error)
	// NextUnlock returns the earliest unlock instant after the given one, or
	// the zero time when no later unlock is scheduled.
	NextUnlock(ctx context.Context, after time.Time) (time.Time, error)
	Create(context.Context, Actor, Input, int) (Event, error)
	Update(context.Context, Actor, int64, Input) (Event, error)
	Delete(context.Context, Actor, int64) error
	TransitionVote(context.Context, Actor, int64, VoteStatus, int64) (Event, error)
	CastVote(context.Context, Actor, int64, int64) (Event, error)
}

// eventLimit bounds the programme; creation enforces it transactionally.
const eventLimit = 200

// Service validates event changes and controls when authored content becomes visible.
type Service struct{ repository Repository }

// New uses the supplied persistence port without starting background work.
func New(repository Repository) *Service { return &Service{repository: repository} }

// List orders the bounded programme by start time and applies reveal rules.
func (s *Service) List(ctx context.Context, clock func() time.Time, guestID int64, private bool) ([]Event, error) {
	now := clock()
	items, err := s.repository.List(ctx, eventLimit, guestID, private, now)
	if err != nil {
		return nil, err
	}
	return sortByStart(items), nil
}

// sortByStart orders events by start time and then ID. Unscheduled events
// keep their order after the scheduled ones.
func sortByStart(items []Event) []Event {
	type entry struct {
		event     Event
		start     time.Time
		scheduled bool
	}
	entries := make([]entry, len(items))
	for i, event := range items {
		entries[i] = entry{event: event, scheduled: event.StartsAt != nil}
		if event.StartsAt != nil {
			entries[i].start, _ = timestamp.Parse(*event.StartsAt)
		}
	}
	slices.SortStableFunc(entries, func(a, b entry) int {
		switch {
		case !a.scheduled && !b.scheduled:
			return 0
		case !a.scheduled:
			return 1
		case !b.scheduled:
			return -1
		}
		if order := a.start.Compare(b.start); order != 0 {
			return order
		}
		return cmp.Compare(a.event.ID, b.event.ID)
	})
	for i := range entries {
		items[i] = entries[i].event
	}
	return items
}

// Create validates an event and enforces the collection limit transactionally.
func (s *Service) Create(ctx context.Context, actor Actor, input Input) (Event, error) {
	if input.Type == "" {
		input.Type = TypeEvent
	}
	input, err := input.normalize()
	if err != nil {
		return Event{}, err
	}
	return s.repository.Create(ctx, actor, input, eventLimit)
}

// Update replaces the host-authored fields of an existing event.
func (s *Service) Update(ctx context.Context, actor Actor, id int64, input Input) (Event, error) {
	input, err := input.normalize()
	if err != nil {
		return Event{}, err
	}
	return s.repository.Update(ctx, actor, id, input)
}

// Delete removes an event, returning ErrNotFound when it is absent.
func (s *Service) Delete(ctx context.Context, actor Actor, id int64) error {
	return s.repository.Delete(ctx, actor, id)
}

// NextUnlock returns the next scheduled unlock after now, or the zero time.
func (s *Service) NextUnlock(ctx context.Context, now time.Time) (time.Time, error) {
	return s.repository.NextUnlock(ctx, now)
}
