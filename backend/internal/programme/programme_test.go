package programme

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestViewProtectsScheduledContent(t *testing.T) {
	unlock := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	stamp := unlock.Format(time.RFC3339Nano)
	invalid := "invalid"
	for _, test := range []struct {
		name     string
		now      time.Time
		unlockAt *string
		private  bool
		teaser   string
		locked   bool
		visible  bool
	}{
		{"before unlock", unlock.Add(-time.Nanosecond), &stamp, false, "A surprise", true, false},
		{"at unlock", unlock, &stamp, false, "A surprise", false, true},
		{"after unlock", unlock.Add(time.Nanosecond), &stamp, false, "A surprise", false, true},
		{"host can edit locked content", unlock.Add(-time.Nanosecond), &stamp, true, "A surprise", true, true},
		{"no schedule", unlock, nil, false, "", false, true},
		{"missing teaser", unlock.Add(-time.Nanosecond), &stamp, false, "", true, false},
		{"invalid stored time fails closed", unlock, &invalid, false, "", true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			event := Event{Title: "Secret concert", Description: "Private performer and location", Teaser: test.teaser, UnlockAt: test.unlockAt}
			view := event.View(test.now, test.private)
			if view.Locked != test.locked {
				t.Fatalf("locked=%v want=%v", view.Locked, test.locked)
			}
			if test.visible {
				if view.Title != event.Title || view.Description != event.Description {
					t.Fatal("visible event lost authored content")
				}
			} else if view.Title != test.teaser || view.Description != "" {
				t.Fatal("locked event exposed authored content")
			}
		})
	}
}

func TestInputNormalizesTimesAndBoundsAuthoredContent(t *testing.T) {
	local := "2026-10-17T20:15:00+02:00"
	input, err := (Input{Title: "  A concert  ", Description: "  Details  ", Teaser: "  Later  ", StartsAt: &local, UnlockAt: &local}).normalize()
	if err != nil {
		t.Fatal(err)
	}
	if input.Title != "A concert" || input.Description != "Details" || input.Teaser != "Later" || *input.StartsAt != "2026-10-17T18:15:00Z" || *input.UnlockAt != "2026-10-17T18:15:00Z" {
		t.Fatalf("unexpected normalization: %+v", input)
	}
	if local != "2026-10-17T20:15:00+02:00" {
		t.Fatal("normalization changed the caller's timestamp")
	}
	for _, test := range []struct {
		name  string
		input Input
		want  error
	}{
		{"empty title", Input{Title: "  "}, ErrInvalidEvent},
		{"unknown type", Input{Title: "Dinner", Type: "unknown"}, ErrInvalidEvent},
		{"vote without settings", Input{Title: "Vote", Type: "vote"}, ErrInvalidEvent},
		{"ordinary event with vote settings", Input{Title: "Dinner", Type: "event", Vote: &VoteInput{}}, ErrInvalidEvent},
		{"long title", Input{Title: strings.Repeat("é", 161)}, ErrInvalidEvent},
		{"long description", Input{Title: "Concert", Description: strings.Repeat("a", 4001)}, ErrInvalidEvent},
		{"long teaser", Input{Title: "Concert", Teaser: strings.Repeat("a", 161)}, ErrInvalidEvent},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := test.input.normalize(); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
	for _, value := range []string{"invalid", "1999-12-31T23:59:59Z", "2201-01-01T00:00:00Z"} {
		for _, input := range []Input{{Title: "Concert", StartsAt: &value}, {Title: "Concert", UnlockAt: &value}} {
			if _, err := input.normalize(); !errors.Is(err, ErrInvalidDate) {
				t.Fatalf("timestamp %q: error=%v", value, err)
			}
		}
	}
}
