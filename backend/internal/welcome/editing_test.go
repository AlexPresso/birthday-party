package welcome

import (
	"errors"
	"reflect"
	"testing"
)

func TestEditKeepsTheRunAndReconcilesTheUnlockedBoundary(t *testing.T) {
	steps := []Step{{Widgets: []Widget{{Type: "text", Text: "One"}}}, {Widgets: []Widget{{Type: "text", Text: "Two"}}}}
	for _, test := range []struct {
		name       string
		open       bool
		generation int64
		unlocked   int
		steps      []Step
		want       int
	}{
		{"before the first run", true, 0, 0, steps, 0},
		{"waiting for the first unlock", false, 3, 0, steps, 0},
		{"new steps remain locked", false, 3, 1, steps, 1},
		{"removed steps reduce the boundary", false, 3, 2, steps[:1], 1},
		{"all steps removed while closed", false, 3, 2, []Step{}, 0},
		{"open access includes new steps", true, 3, 1, steps, 2},
		{"open access with all steps removed", true, 3, 2, []Step{}, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := State{Open: test.open, Generation: test.generation, Revision: 17, Required: true, CurrentStep: test.unlocked, Steps: steps}
			updated, err := Edit(state, state.Revision, test.steps)
			if err != nil {
				t.Fatal(err)
			}
			if updated.CurrentStep != test.want || !reflect.DeepEqual(updated.Steps, test.steps) {
				t.Fatalf("edited sequence=%+v, want unlocked=%d steps=%+v", updated, test.want, test.steps)
			}
			if updated.Open != state.Open || updated.Generation != state.Generation || updated.Required != state.Required || updated.Revision != state.Revision {
				t.Fatalf("editing changed the run or access policy: %+v", updated)
			}
			if stale, err := Edit(state, state.Revision-1, test.steps); !errors.Is(err, ErrConflict) || !reflect.DeepEqual(stale, state) {
				t.Fatalf("stale edit changed state: state=%+v error=%v", stale, err)
			}
		})
	}
}

func TestEditInvalidatesOnlyChangedWidgetContexts(t *testing.T) {
	firstCategory, sameCategory, secondCategory := int64(1), int64(1), int64(2)
	title := Widget{Type: "title", Text: "Before uploading"}
	text := Widget{Type: "text", Text: "Choose an image"}
	main := Widget{Type: "media_upload", MediaUpload: &MediaUpload{}}
	private := Widget{Type: "media_upload", MediaUpload: &MediaUpload{CategoryID: &firstCategory}}
	otherPrivate := Widget{Type: "media_upload", MediaUpload: &MediaUpload{CategoryID: &secondCategory}}
	profile := Widget{Type: "profile_photo"}
	for _, test := range []struct {
		name     string
		previous []Widget
		updated  []Widget
		changed  bool
	}{
		{"unchanged upload", []Widget{title, main}, []Widget{title, main}, false},
		{"title correction", []Widget{title, main}, []Widget{{Type: "title", Text: "Choose your media"}, main}, false},
		{"instruction correction", []Widget{text, main}, []Widget{{Type: "text", Text: "Choose a photo or video"}, main}, false},
		{"same category value", []Widget{private}, []Widget{{Type: "media_upload", MediaUpload: &MediaUpload{CategoryID: &sameCategory}}}, false},
		{"new private destination", []Widget{main}, []Widget{private}, true},
		{"new main destination", []Widget{private}, []Widget{main}, true},
		{"changed category", []Widget{private}, []Widget{otherPrivate}, true},
		{"media widget moves to another index", []Widget{text, main}, []Widget{main, text}, true},
		{"media destinations reordered", []Widget{private, otherPrivate}, []Widget{otherPrivate, private}, true},
		{"text inserted before upload", []Widget{main}, []Widget{text, main}, true},
		{"profile permission removed", []Widget{main, profile}, []Widget{main}, true},
		{"notification permission added", []Widget{main}, []Widget{main, {Type: "enable_notifications"}}, true},
		{"upload replaced with profile", []Widget{main}, []Widget{profile}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			previous := State{Generation: 4, CurrentStep: 1, Steps: []Step{{Widgets: test.previous}}}
			updated, err := Edit(previous, 0, []Step{{Widgets: test.updated}})
			if err != nil {
				t.Fatal(err)
			}
			progress := Progress{Generation: 4, Position: 1, Revision: 83}
			actual, changed := ReconcileProgress(previous, updated, progress)
			if changed != test.changed || actual != progress {
				t.Fatalf("reconciled=%+v changed=%v, want progress=%+v changed=%v", actual, changed, progress, test.changed)
			}
		})
	}
}

func TestEditPreservesGuestPositionsAndCompletion(t *testing.T) {
	first := Step{Widgets: []Widget{{Type: "media_upload", MediaUpload: &MediaUpload{}}}}
	second := Step{Widgets: []Widget{{Type: "profile_photo"}}}
	replacement := Step{Widgets: []Widget{{Type: "enable_notifications"}}}
	for _, test := range []struct {
		name      string
		steps     []Step
		progress  Progress
		position  int
		changed   bool
		canFinish bool
	}{
		{"other step changes", []Step{first, replacement}, Progress{Generation: 2, Position: 1, Revision: 11}, 1, false, false},
		{"current slot changes after reordering", []Step{second, first}, Progress{Generation: 2, Position: 1, Revision: 11}, 1, true, false},
		{"selected step removed", []Step{first}, Progress{Generation: 2, Position: 2, Revision: 11}, 1, true, true},
		{"all steps removed", []Step{}, Progress{Generation: 2, Position: 2, Revision: 11}, 0, true, true},
		{"waiting guest stays waiting", []Step{second, first}, Progress{Generation: 2, Revision: 11}, 0, false, false},
		{"completed guest keeps access", []Step{}, Progress{Generation: 2, Position: 2, Revision: 11, Completed: true}, 2, false, false},
		{"previous run stays untouched", []Step{}, Progress{Generation: 1, Position: 2, Revision: 11}, 2, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			previous := State{Open: true, Required: true, Generation: 2, CurrentStep: 2, Steps: []Step{first, second}}
			updated, err := Edit(previous, 0, test.steps)
			if err != nil {
				t.Fatal(err)
			}
			progress, changed := ReconcileProgress(previous, updated, test.progress)
			want := test.progress
			want.Position = test.position
			if progress != want || changed != test.changed {
				t.Fatalf("reconciled=%+v changed=%v, want progress=%+v changed=%v", progress, changed, want, test.changed)
			}
			view := GuestView(updated, progress)
			if view.CanFinish != test.canFinish || view.Open != test.progress.Completed {
				t.Fatalf("unexpected access or finish state: %+v", view)
			}
		})
	}
}
