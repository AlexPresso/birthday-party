package programme

import (
	"testing"
	"time"
)

func TestQuestionResolutionPreservesTheTwoJokerBudget(t *testing.T) {
	for _, tc := range []struct {
		name          string
		current, next QuestionStatus
		used          int
		revision      int64
		want          error
	}{
		{"first joker", "pending", "joker", 0, 4, nil},
		{"second joker", "pending", "joker", 1, 4, nil},
		{"third joker", "pending", "joker", 2, 4, ErrNoJokers},
		{"answer after both jokers", "pending", "answered", 2, 4, nil},
		{"stale action", "pending", "joker", 0, 3, ErrActivityConflict},
		{"cannot undo a joker", "joker", "pending", 1, 4, ErrActivityConflict},
		{"cannot skip an answered question", "answered", "joker", 0, 4, ErrActivityConflict},
		{"unknown action", "pending", "hidden", 0, 4, ErrInvalidQuestion},
	} {
		t.Run(tc.name, func(t *testing.T) {
			round := QuestionRound{QuestionSummary: QuestionSummary{Status: "open", JokersUsed: tc.used}, Revision: 4}
			if err := round.CheckResolution(tc.current, tc.next, tc.revision); err != tc.want {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestQuestionEventHidesItsRoundUntilUnlock(t *testing.T) {
	now := time.Date(2026, 11, 5, 20, 0, 0, 0, time.UTC)
	unlock := now.Add(time.Minute).Format(time.RFC3339)
	event := Event{Type: "questions", Title: "Private title", UnlockAt: &unlock, Questions: &QuestionSummary{Status: "open"}}
	if view := event.View(now, false); !view.Locked || view.Questions != nil || view.Title != "" {
		t.Fatalf("locked round leaked: %+v", view)
	}
	if event.View(now.Add(time.Minute), false).Questions == nil {
		t.Fatal("round stayed hidden at unlock")
	}
}
