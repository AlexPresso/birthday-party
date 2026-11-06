package programme

import (
	"context"
	"errors"
	"testing"
	"time"
)

type memoryEvents struct {
	items     []Event
	input     Input
	writes    int
	limit     int
	err       error
	afterRead func()
}

func (repository *memoryEvents) List(_ context.Context, limit int, _ int64, private bool, now time.Time) ([]Event, error) {
	repository.limit = limit
	if repository.afterRead != nil {
		repository.afterRead()
	}
	items := make([]Event, 0, len(repository.items))
	for _, event := range repository.items {
		items = append(items, event.View(now, private))
	}
	return items, repository.err
}

func (repository *memoryEvents) UnlockTimes(_ context.Context, limit int) ([]string, error) {
	repository.limit = limit
	times := []string{}
	for _, event := range repository.items {
		if event.UnlockAt != nil {
			times = append(times, *event.UnlockAt)
		}
	}
	return times, repository.err
}

func (repository *memoryEvents) Create(_ context.Context, _ Actor, input Input, limit int) (Event, error) {
	repository.input, repository.limit = input, limit
	repository.writes++
	return Event{ID: 7}, repository.err
}

func (repository *memoryEvents) Update(_ context.Context, _ Actor, _ int64, input Input) (Event, error) {
	repository.input = input
	repository.writes++
	return Event{}, repository.err
}

func (repository *memoryEvents) Delete(context.Context, Actor, int64) error { return repository.err }
func (repository *memoryEvents) TransitionVote(context.Context, Actor, int64, string, int64) (Event, error) {
	return Event{}, repository.err
}
func (repository *memoryEvents) CastVote(context.Context, Actor, int64, int64) (Event, error) {
	return Event{}, repository.err
}

func TestServiceValidatesBeforePersistenceAndUsesAtomicCapacity(t *testing.T) {
	repository := &memoryEvents{}
	service := New(repository)
	if _, err := service.Create(t.Context(), Actor{}, Input{}); !errors.Is(err, ErrInvalidEvent) {
		t.Fatalf("error=%v", err)
	}
	if _, err := service.Update(t.Context(), Actor{}, 7, Input{}); !errors.Is(err, ErrInvalidEvent) {
		t.Fatalf("error=%v", err)
	}
	if repository.writes != 0 {
		t.Fatal("invalid input reached persistence")
	}
	local := "2026-10-17T20:00:00+02:00"
	event, err := service.Create(t.Context(), Actor{}, Input{Title: "  Concert  ", StartsAt: &local})
	if err != nil {
		t.Fatal(err)
	}
	if event.ID != 7 || repository.input.Title != "Concert" || *repository.input.StartsAt != "2026-10-17T18:00:00Z" || repository.limit != 200 {
		t.Fatalf("event=%+v persisted=%+v limit=%d", event, repository.input, repository.limit)
	}
	repository.err = ErrLimitReached
	if _, err := service.Create(t.Context(), Actor{}, Input{Title: "Concert"}); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("atomic capacity error=%v", err)
	}
}

func TestServiceAppliesAudienceRulesWithoutMutatingStoredEvents(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	soon := now.Add(time.Minute).Format(time.RFC3339Nano)
	later := now.Add(time.Hour).Format(time.RFC3339Nano)
	repository := &memoryEvents{items: []Event{{ID: 3, Title: "Unscheduled"}, {ID: 2, Title: "Secret", Description: "Private details", Teaser: "Later", StartsAt: &later, UnlockAt: &soon}, {ID: 1, Title: "First", StartsAt: &soon}}}
	items, err := New(repository).List(t.Context(), func() time.Time { return now }, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	if items[0].ID != 1 || items[1].ID != 2 || items[2].ID != 3 || items[1].Title != "Later" || items[1].Description != "" {
		t.Fatalf("guest programme=%+v", items)
	}
	if repository.items[1].Title != "Secret" || repository.items[1].Description != "Private details" {
		t.Fatal("guest view changed stored content")
	}
}

func TestServiceSchedulesOnlyValidFutureUnlocks(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	past, current := now.Add(-time.Hour).Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)
	soon, later := now.Add(time.Minute).Format(time.RFC3339Nano), now.Add(time.Hour).Format(time.RFC3339Nano)
	malformed := "invalid"
	repository := &memoryEvents{items: []Event{{UnlockAt: &past}, {UnlockAt: &current}, {UnlockAt: &later}, {UnlockAt: &malformed}, {}, {UnlockAt: &soon}}}
	next, err := New(repository).NextUnlock(t.Context(), now)
	if err != nil || !next.Equal(now.Add(time.Minute)) || repository.limit != readLimit {
		t.Fatalf("next=%v error=%v", next, err)
	}
	next, err = New(repository).NextUnlock(t.Context(), now.Add(time.Hour))
	if err != nil || !next.IsZero() {
		t.Fatalf("exhausted next=%v error=%v", next, err)
	}
}

func TestProgrammeKeepsOneVisibilityInstantAcrossRead(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	unlock := now.Add(time.Second)
	stamp := unlock.Format(time.RFC3339Nano)
	repository := &memoryEvents{items: []Event{{Title: "Concert", Description: "Now revealed", Teaser: "Later", UnlockAt: &stamp}}, afterRead: func() { now = unlock }}
	items, err := New(repository).List(t.Context(), func() time.Time { return now }, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	if !items[0].Locked || items[0].Title != "Later" || items[0].Description != "" {
		t.Fatalf("event mixed visibility instants: %+v", items[0])
	}
}
