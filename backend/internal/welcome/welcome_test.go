package welcome

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestAccessForLateArrivalsAndExistingParticipants(t *testing.T) {
	for _, test := range []struct {
		name     string
		state    State
		progress Progress
		want     bool
	}{
		{"before first run", State{Open: true}, Progress{}, true},
		{"host has closed", State{Generation: 1}, Progress{Generation: 1, Completed: true}, false},
		{"optional late arrival", State{Open: true, Generation: 1}, Progress{}, true},
		{"required late arrival", State{Open: true, Generation: 1, Required: true}, Progress{}, false},
		{"existing participant finishes explicitly", State{Open: true, Generation: 1}, Progress{Generation: 1}, false},
		{"completed participant", State{Open: true, Generation: 1, Required: true}, Progress{Generation: 1, Completed: true}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := HasAccess(test.state, test.progress); got != test.want {
				t.Fatalf("access=%v, want %v", got, test.want)
			}
		})
	}
}

func TestHostUnlockPreservesGuestPositionAndRevision(t *testing.T) {
	state := State{Generation: 1, Revision: 5, CurrentStep: 1, Steps: []Step{{Widgets: []Widget{{Type: "title", Text: "First"}}}, {Widgets: []Widget{{Type: "title", Text: "Second"}}}}}
	progress := Progress{Generation: 1, Position: 1, Revision: 42}
	unlocked, err := Transition(state, 5, "next")
	if err != nil {
		t.Fatal(err)
	}
	view := GuestView(unlocked, progress)
	if view.Step == nil || view.Step.Position != 1 || view.Step.Widgets[0].Text != "First" || !view.CanNext || view.ProgressRevision != 42 {
		t.Fatalf("guest moved during unlock: %+v", view)
	}
	if _, err = Transition(state, 4, "next"); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale host command error=%v", err)
	}
	if _, err = Edit(unlocked, 5, []Step{}); !errors.Is(err, ErrStepsLocked) {
		t.Fatalf("unlocked edit error=%v", err)
	}
}

func TestRequiredLateArrivalNavigatesBeforeFinishing(t *testing.T) {
	state := State{Open: true, Required: true, Generation: 3, CurrentStep: 2, Steps: []Step{{Widgets: []Widget{{Type: "text", Text: "One"}}}, {Widgets: []Widget{{Type: "text", Text: "Two"}}}}}
	progress := InitialProgress(state)
	progress.Revision = 7
	if progress.Position != 1 || progress.Completed {
		t.Fatalf("required late arrival=%+v", progress)
	}
	if _, err := Navigate(state, progress, 7, "finish"); !errors.Is(err, ErrTransition) {
		t.Fatalf("early finish error=%v", err)
	}
	if _, err := Navigate(state, progress, 6, "next"); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale navigation error=%v", err)
	}
	next, err := Navigate(state, progress, 7, "next")
	if err != nil {
		t.Fatal(err)
	}
	previous, err := Navigate(state, next, 7, "previous")
	if err != nil || previous.Position != 1 {
		t.Fatalf("previous=%+v error=%v", previous, err)
	}
	finished, err := Navigate(state, next, 7, "finish")
	if err != nil || !HasAccess(state, finished) {
		t.Fatalf("finish=%+v error=%v", finished, err)
	}
}

func TestStepsNormalizeWithoutMutatingCallerAndRejectInvalidWidgets(t *testing.T) {
	category := int64(4)
	steps := []Step{{Widgets: []Widget{{Type: "title", Text: "  Authored title  "}, {Type: "media_upload", MediaUpload: &MediaUpload{CategoryID: &category}}}}}
	normalized, err := NormalizeSteps(steps)
	if err != nil {
		t.Fatal(err)
	}
	if normalized[0].Widgets[0].Text != "Authored title" || steps[0].Widgets[0].Text != "  Authored title  " {
		t.Fatal("normalization changed caller state")
	}
	*normalized[0].Widgets[1].MediaUpload.CategoryID = 8
	if category != 4 {
		t.Fatal("normalization retained a mutable destination pointer")
	}
	for _, widgets := range [][]Widget{
		{}, {{Type: "unknown"}}, {{Type: "title", Text: strings.Repeat("é", 121)}},
		{{Type: "profile_photo"}, {Type: "profile_photo"}}, {{Type: "enable_notifications"}, {Type: "enable_notifications"}},
		{{Type: "media_upload"}}, {{Type: "profile_photo", Text: "Not allowed"}},
	} {
		if _, err := NormalizeSteps([]Step{{Widgets: widgets}}); err == nil {
			t.Fatalf("accepted widgets %+v", widgets)
		}
	}
}

type rejectingRepository struct{ Repository }

func TestServiceRejectsInvalidStepsBeforePersistence(t *testing.T) {
	service := New(rejectingRepository{})
	if _, err := service.Edit(context.Background(), 0, nil); !errors.Is(err, ErrInvalidSteps) {
		t.Fatalf("invalid steps error=%v", err)
	}
}
