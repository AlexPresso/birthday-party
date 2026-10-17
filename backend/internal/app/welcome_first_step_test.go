package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestWelcomeRestoresWaitingProgressAtFirstStepAfterMissedUnlocks(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Returning waiting guest")
	steps := []welcomeStep{testWelcomeStep("First", ""), testWelcomeStep("Second", ""), testWelcomeStep("Third", "")}
	state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
	state = changeWelcome(t, a, host, state.Revision, "start")
	waiting := readGuestWelcome(t, a, visitor)
	if waiting.Step != nil || waiting.CanNext {
		t.Fatalf("guest entered a step before unlocking: %+v", waiting)
	}
	for range len(steps) {
		state = changeWelcome(t, a, host, state.Revision, "next")
	}
	// Persisted position-zero rows from an earlier version must recover on GET,
	// even if the guest reconnects after several unlocks and a server restart.
	config, clock := a.config, a.now
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	reopened.now = clock
	view := readGuestWelcome(t, reopened, visitor)
	if view.Open || view.Step == nil || view.Step.Position != 1 || !view.CanNext || view.CanPrevious || view.ProgressRevision <= waiting.ProgressRevision {
		t.Fatalf("reconnect skipped the first step or retained a waiting token: %+v", view)
	}
	if repeated := readGuestWelcome(t, reopened, visitor); repeated.Step == nil || repeated.Step.Position != 1 || repeated.ProgressRevision != view.ProgressRevision {
		t.Fatalf("repeated reconnect changed current progress: %+v", repeated)
	}
}

func TestWelcomeOpeningFromWaitingAutomaticallySelectsFirstStep(t *testing.T) {
	for _, required := range []bool{false, true} {
		name := "optional"
		if required {
			name = "required"
		}
		t.Run(name, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, _, _ := guest(t, a, host, "Waiting before opening")
			steps := []welcomeStep{testWelcomeStep("First", ""), testWelcomeStep("Second", "")}
			state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
			state = setWelcomeRequired(t, a, host, state, required)
			state = changeWelcome(t, a, host, state.Revision, "start")
			waiting := readGuestWelcome(t, a, visitor)
			changeWelcome(t, a, host, state.Revision, "open")
			view := readGuestWelcome(t, a, visitor)
			if view.Open || view.Step == nil || view.Step.Position != 1 || !view.CanNext || view.ProgressRevision <= waiting.ProgressRevision || view.CanFinish == required {
				t.Fatalf("opening the app skipped or trapped a waiting guest: %+v", view)
			}
			assertWelcomeError(t, request(t, a, "GET", "/api/party", nil, visitor), 423, "welcome_required")
		})
	}
}

func TestWelcomeEmptySequenceWaitsUntilFirstStepIsAvailable(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Waiting for a new step")
	state := changeWelcome(t, a, host, 0, "start")
	waiting := readGuestWelcome(t, a, visitor)
	if waiting.Step != nil || waiting.CanNext || waiting.CanPrevious || waiting.CanFinish {
		t.Fatalf("empty sequence exposed navigation: %+v", waiting)
	}
	steps := []welcomeStep{testWelcomeStep("Choose a photo", "", welcomeWidget{Type: "profile_photo"})}
	state = editWelcomeSteps(t, a, host, state, steps)
	if view := readGuestWelcome(t, a, visitor); view.Step != nil || view.CanNext || view.ProgressRevision != waiting.ProgressRevision {
		t.Fatalf("saving a locked first step moved the guest: %+v", view)
	}
	assertWelcomeError(t, request(t, a, "GET", "/api/profile", nil, visitor), 423, "welcome_required")
	changeWelcome(t, a, host, state.Revision, "next")
	view := readGuestWelcome(t, a, visitor)
	if view.Step == nil || view.Step.Position != 1 || view.ProgressRevision <= waiting.ProgressRevision || view.CanPrevious || view.CanNext {
		t.Fatalf("newly available first step was not selected: %+v", view)
	}
	status(t, request(t, a, "GET", "/api/profile", nil, visitor), 200)
}

func TestConcurrentWelcomeRefreshSelectsFirstStepOnlyOnce(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Concurrent waiting guest")
	state := editWelcomeSteps(t, a, host, welcomeState{}, []welcomeStep{testWelcomeStep("First", "")})
	state = changeWelcome(t, a, host, state.Revision, "start")
	waiting := readGuestWelcome(t, a, visitor)
	changeWelcome(t, a, host, state.Revision, "next")
	var responses [2]*httptest.ResponseRecorder
	var group sync.WaitGroup
	for i := range responses {
		group.Go(func() {
			responses[i] = request(t, a, "GET", "/api/welcome", nil, visitor)
		})
	}
	group.Wait()
	var revision int64
	for _, response := range responses {
		status(t, response, 200)
		var view welcomeView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if view.Step == nil || view.Step.Position != 1 || view.ProgressRevision <= waiting.ProgressRevision {
			t.Fatalf("concurrent refresh failed to enter the first step: %+v", view)
		}
		if revision != 0 && revision != view.ProgressRevision {
			t.Fatalf("concurrent refresh rotated the first-step token twice: %d then %d", revision, view.ProgressRevision)
		}
		revision = view.ProgressRevision
	}
}

func TestWelcomeFirstStepRefreshConsumesOnlyItsUnlockNotification(t *testing.T) {
	a := testApp(t)
	host, visitor, state, _ := queuedTestNotification(t, a)
	first := readGuestWelcome(t, a, visitor)
	if first.Step == nil || first.Step.Position != 1 {
		t.Fatalf("notification refresh did not select the first step: %+v", first)
	}
	calls := 0
	a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	processed, err := a.notifications.ProcessNext(t.Context())
	if err != nil || processed || calls != 0 || notificationOutboxCount(t, a) != 0 {
		t.Fatalf("viewed first step retained its unlock notification: processed=%v calls=%d error=%v", processed, calls, err)
	}
	changeWelcome(t, a, host, state.Revision, "next")
	if view := readGuestWelcome(t, a, visitor); view.Step == nil || view.Step.Position != 1 || view.ProgressRevision != first.ProgressRevision {
		t.Fatalf("later notification refresh advanced the guest: %+v", view)
	}
	processed, err = a.notifications.ProcessNext(t.Context())
	if err != nil || !processed || calls != 1 {
		t.Fatalf("unvisited later step lost its unlock notification: processed=%v calls=%d error=%v", processed, calls, err)
	}
}
