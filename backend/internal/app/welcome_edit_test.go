package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func editWelcomeSteps(t *testing.T, a *App, host *http.Cookie, state welcomeState, steps []welcomeStep) welcomeState {
	t.Helper()
	return readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": state.Revision, "steps": steps}, host))
}

func TestWelcomeLiveTextEditsPreserveCurrentUploadsAndHiddenContent(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Editing instructions guest")
	steps := []welcomeStep{
		testWelcomeStep("Upload a photo", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}}),
		testWelcomeStep("Hidden instruction", "", welcomeWidget{Type: "profile_photo"}),
	}
	state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
	if state.CurrentStep != 0 || !state.Open {
		t.Fatalf("editing before the first run changed initial access: %+v", state)
	}
	state = setWelcomeRequired(t, a, host, state, true)
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "next")
	before := selectGuestWelcomeStep(t, a, visitor, 1)
	persisted, err := scanWelcome(a.db.QueryRow(welcomeSelect))
	if err != nil {
		t.Fatal(err)
	}
	oldRevision := state.Revision
	r := mediaUploadRequest(t, visitor, nil, &before.ProgressRevision, "")
	r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
		steps[0].Widgets[0].Text = "Choose a photo"
		steps[1] = testWelcomeStep("Revised hidden instruction", "", welcomeWidget{Type: "enable_notifications"})
		state = editWelcomeSteps(t, a, host, state, steps)
	}})
	status(t, performMediaUpload(a, r), 202)
	after := readGuestWelcome(t, a, visitor)
	if after.ProgressRevision != before.ProgressRevision || after.Step == nil || after.Step.Position != 1 || after.Step.Widgets[0].Text != "Choose a photo" {
		t.Fatalf("text or future-step edit interrupted current progress: %+v", after)
	}
	response := request(t, a, "GET", "/api/welcome", nil, visitor)
	if strings.Contains(response.Body.String(), "Revised hidden instruction") || strings.Contains(response.Body.String(), "enable_notifications") {
		t.Fatal("editing a future step exposed it to a waiting guest")
	}
	updated, err := scanWelcome(a.db.QueryRow(welcomeSelect))
	if err != nil {
		t.Fatal(err)
	}
	if updated.Generation != persisted.Generation || updated.CurrentStep != 1 || updated.Open || !updated.Required {
		t.Fatalf("live editing changed the welcome run: %+v", updated)
	}
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": state.Revision, "steps": steps}, visitor), 403, "admin_required")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": oldRevision, "steps": []welcomeStep{}}, host), 409, "welcome_conflict")
}

func TestWelcomeLiveWidgetEditsRejectStaleMediaAcceptance(t *testing.T) {
	for _, change := range []string{"destination", "widget position"} {
		t.Run(change, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, _, _ := guest(t, a, host, "Changing upload widget guest")
			category := createTestCategory(t, a, host, "Private contributions", false)
			steps := []welcomeStep{testWelcomeStep("Upload", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &category.ID}})}
			state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
			state = changeWelcome(t, a, host, state.Revision, "start")
			state = changeWelcome(t, a, host, state.Revision, "next")
			before := selectGuestWelcomeStep(t, a, visitor, 1)
			r := mediaUploadRequest(t, visitor, nil, &before.ProgressRevision, "")
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				if change == "destination" {
					steps[0].Widgets[1].MediaUpload = &welcomeMediaUpload{}
				} else {
					steps[0].Widgets = []welcomeWidget{steps[0].Widgets[1], steps[0].Widgets[0]}
				}
				state = editWelcomeSteps(t, a, host, state, steps)
			}})
			assertWelcomeError(t, performMediaUpload(a, r), 409, "welcome_conflict")
			assertNoAcceptedMedia(t, a)
			after := readGuestWelcome(t, a, visitor)
			if after.ProgressRevision <= before.ProgressRevision || after.Step == nil || after.Step.Position != 1 {
				t.Fatalf("editing a current action did not invalidate its token: %+v", after)
			}
			fresh := mediaUploadRequest(t, visitor, nil, &after.ProgressRevision, "")
			if change == "widget position" {
				fresh.Header.Set("X-Welcome-Widget-Index", "0")
			}
			accepted := performMediaUpload(a, fresh)
			status(t, accepted, 202)
			job := parseJob(t, accepted)
			if change == "destination" && job.CategoryID != nil || change == "widget position" && !sameOptionalID(job.CategoryID, &category.ID) {
				t.Fatalf("refreshed upload did not use the edited destination: %+v", job)
			}
		})
	}
}

func TestWelcomeLiveEditsPreserveAcceptedUploadsAcrossRestart(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Accepted upload guest")
	category := createTestCategory(t, a, host, "Original private destination", false)
	steps := []welcomeStep{testWelcomeStep("Upload", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &category.ID}})}
	state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "next")
	before := selectGuestWelcomeStep(t, a, visitor, 1)
	accepted := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &before.ProgressRevision, ""))
	status(t, accepted, 202)
	job := parseJob(t, accepted)
	steps[0].Widgets[1].MediaUpload = &welcomeMediaUpload{}
	state = editWelcomeSteps(t, a, host, state, steps)
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
	a = reopened
	photo := finishCategoryUpload(t, a, accepted)
	if !sameOptionalID(photo.CategoryID, &category.ID) {
		t.Fatal("editing a widget retargeted an accepted upload")
	}
	path := "/api/uploads/" + strconv.FormatInt(job.ID, 10)
	ready := parseJob(t, request(t, a, "GET", path, nil, visitor))
	if ready.Status != "ready" || ready.Photo != nil || !sameOptionalID(ready.WelcomeRevision, job.WelcomeRevision) || !sameOptionalID(ready.WelcomeWidgetIndex, job.WelcomeWidgetIndex) || !sameOptionalID(ready.CategoryID, job.CategoryID) {
		t.Fatalf("live editing or recovery changed accepted upload context: %+v", ready)
	}
	changeWelcome(t, a, host, state.Revision, "open")
	moveGuestWelcome(t, a, visitor, "finish")
	status(t, request(t, a, "GET", photo.URL, nil, visitor), 404)
	status(t, request(t, a, "GET", photo.URL, nil, host), 200)
	if parseJob(t, request(t, a, "GET", path, nil, visitor)).Photo != nil {
		t.Fatal("changing the widget destination exposed its earlier private contribution")
	}
}

func TestWelcomeLiveEditsClampRemovedStepsWithoutRestarting(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First step guest")
	last, _, _ := guest(t, a, host, "Last step guest")
	steps := []welcomeStep{testWelcomeStep("One", ""), testWelcomeStep("Two", ""), testWelcomeStep("Three", "")}
	state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
	state = setWelcomeRequired(t, a, host, state, true)
	state = changeWelcome(t, a, host, state.Revision, "start")
	for range len(steps) {
		state = changeWelcome(t, a, host, state.Revision, "next")
	}
	firstBefore := selectGuestWelcomeStep(t, a, first, 1)
	lastBefore := selectGuestWelcomeStep(t, a, last, 3)
	state = editWelcomeSteps(t, a, host, state, steps[:1])
	firstAfter := readGuestWelcome(t, a, first)
	lastAfter := readGuestWelcome(t, a, last)
	if state.Open || state.CurrentStep != 1 || !state.Required || firstAfter.ProgressRevision != firstBefore.ProgressRevision || lastAfter.ProgressRevision <= lastBefore.ProgressRevision || lastAfter.Step == nil || lastAfter.Step.Position != 1 {
		t.Fatalf("removing steps did not preserve or clamp guest positions: state=%+v first=%+v last=%+v", state, firstAfter, lastAfter)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": lastBefore.ProgressRevision, "action": "previous"}, last), 409, "welcome_conflict")
	state = editWelcomeSteps(t, a, host, state, []welcomeStep{})
	for _, cookie := range []*http.Cookie{first, last} {
		view := readGuestWelcome(t, a, cookie)
		if view.Open || view.Step != nil || view.CanNext || view.CanPrevious || view.CanFinish {
			t.Fatalf("empty closed sequence retained an invalid step: %+v", view)
		}
	}
	state = changeWelcome(t, a, host, state.Revision, "open")
	late, _, _ := guest(t, a, host, "Empty sequence late guest")
	for _, cookie := range []*http.Cookie{first, last, late} {
		if view := readGuestWelcome(t, a, cookie); view.Step != nil || !view.CanFinish {
			t.Fatalf("empty required sequence trapped a guest: %+v", view)
		}
		if view := moveGuestWelcome(t, a, cookie, "finish"); !view.Open {
			t.Fatal("guest could not finish an empty sequence")
		}
	}
}

func TestWelcomeLiveAppendPreservesCompletionAndRequiredFinishBoundary(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	finished, _, _ := guest(t, a, host, "Finished guest")
	waiting, _, _ := guest(t, a, host, "Unfinished guest")
	steps := []welcomeStep{testWelcomeStep("One", "")}
	state := editWelcomeSteps(t, a, host, welcomeState{}, steps)
	state = setWelcomeRequired(t, a, host, state, true)
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "open")
	completed := moveGuestWelcome(t, a, finished, "finish")
	before := readGuestWelcome(t, a, waiting)
	if !before.CanFinish {
		t.Fatal("initial final step cannot be finished")
	}
	steps = append(steps, testWelcomeStep("Added instruction", ""))
	state = editWelcomeSteps(t, a, host, state, steps)
	after := readGuestWelcome(t, a, waiting)
	if !state.Open || !state.Required || state.CurrentStep != 2 || after.Step == nil || after.Step.Position != 1 || after.CanFinish || !after.CanNext || after.ProgressRevision != before.ProgressRevision {
		t.Fatalf("appending an open step changed position or skipped required content: state=%+v view=%+v", state, after)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": before.ProgressRevision, "action": "finish"}, waiting), 409, "invalid_welcome_transition")
	late, _, _ := guest(t, a, host, "Late guest after append")
	if view := readGuestWelcome(t, a, late); view.Open || view.Step == nil || view.Step.Position != 1 || view.CanFinish {
		t.Fatalf("late arrival skipped the edited required sequence: %+v", view)
	}
	if view := moveGuestWelcome(t, a, waiting, "next"); !view.CanFinish || view.Step == nil || view.Step.Position != 2 {
		t.Fatalf("new final step could not be reached: %+v", view)
	}
	moveGuestWelcome(t, a, waiting, "finish")
	state = editWelcomeSteps(t, a, host, state, []welcomeStep{})
	if view := readGuestWelcome(t, a, finished); !view.Open || view.Step != nil || view.ProgressRevision != completed.ProgressRevision {
		t.Fatalf("editing an open sequence reset a completed guest: %+v", view)
	}
	status(t, request(t, a, "GET", "/api/party", nil, finished), 200)
}

func TestWelcomeLiveWidgetRemovalRechecksMutationsAfterReadingBody(t *testing.T) {
	for _, widget := range []string{"profile_photo", "enable_notifications"} {
		t.Run(widget, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, _, _ := guest(t, a, host, "Removed widget guest")
			initial := profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
			state := editWelcomeSteps(t, a, host, welcomeState{}, []welcomeStep{{Widgets: []welcomeWidget{{Type: welcomeWidgetType(widget)}}}})
			state = changeWelcome(t, a, host, state.Revision, "start")
			state = changeWelcome(t, a, host, state.Revision, "next")
			selectGuestWelcomeStep(t, a, visitor, 1)
			r := avatarRequest(t, visitor, pngBytes(t))
			input := testNotificationInput(t)
			if widget == "enable_notifications" {
				body, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				r.Method = http.MethodPut
				r.URL.Path = "/api/notifications/subscription"
				r.Header.Set("Content-Type", "application/json")
				r.Body = io.NopCloser(bytes.NewReader(body))
			}
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				editWelcomeSteps(t, a, host, state, []welcomeStep{testWelcomeStep("Updated instruction", "")})
			}})
			assertWelcomeError(t, performMediaUpload(a, r), 423, "welcome_required")
			if widget == "profile_photo" {
				status(t, request(t, a, "GET", *initial.AvatarURL, nil, host), 200)
				assertAvatarTempEmpty(t, a)
			} else if notificationSubscribed(t, a, visitor, input.Endpoint) {
				t.Fatal("removed notification widget accepted an in-flight subscription")
			}
		})
	}
}
