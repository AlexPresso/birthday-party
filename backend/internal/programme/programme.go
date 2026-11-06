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
	ID          int64            `json:"id"`
	Type        string           `json:"type"`
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

// Input is the host-authored event content before normalization and validation.
type Input struct {
	Type        string     `json:"type"`
	Revision    int64      `json:"revision"`
	Vote        *VoteInput `json:"vote"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Teaser      string     `json:"teaser"`
	StartsAt    *string    `json:"startsAt"`
	UnlockAt    *string    `json:"unlockAt"`
}

func (input Input) normalize() (Input, error) {
	if input.Type != "" && input.Type != "event" && input.Type != "vote" && input.Type != "questions" {
		return input, ErrInvalidEvent
	}
	if (input.Type == "event" || input.Type == "questions") && input.Vote != nil || input.Type == "vote" && input.Vote == nil {
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

// View hides unrevealed content from guests. Invalid stored timestamps fail closed.
func (event Event) View(now time.Time, private bool) Event {
	if event.UnlockAt != nil {
		unlock, err := time.Parse(time.RFC3339Nano, *event.UnlockAt)
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
	UnlockTimes(context.Context, int) ([]string, error)
	Create(context.Context, Actor, Input, int) (Event, error)
	Update(context.Context, Actor, int64, Input) (Event, error)
	Delete(context.Context, Actor, int64) error
	TransitionVote(context.Context, Actor, int64, string, int64) (Event, error)
	CastVote(context.Context, Actor, int64, int64) (Event, error)
}

const eventLimit = 200

// Migration can split each of the former 12 nested activities into an event.
// Keep those existing records readable while retaining the creation limit.
const readLimit = eventLimit * 12

// Service validates event changes and controls when authored content becomes visible.
type Service struct{ repository Repository }

// New uses the supplied persistence port without starting background work.
func New(repository Repository) *Service { return &Service{repository: repository} }

// List orders the bounded programme by start time and applies reveal rules.
func (s *Service) List(ctx context.Context, clock func() time.Time, guestID int64, private bool) ([]Event, error) {
	now := clock()
	items, err := s.repository.List(ctx, readLimit, guestID, private, now)
	if err != nil {
		return nil, err
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
func (s *Service) Create(ctx context.Context, actor Actor, input Input) (Event, error) {
	if input.Type == "" {
		input.Type = "event"
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

// NextUnlock ignores malformed legacy times, matching View's fail-closed rule.
func (s *Service) NextUnlock(ctx context.Context, now time.Time) (time.Time, error) {
	times, err := s.repository.UnlockTimes(ctx, readLimit)
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
