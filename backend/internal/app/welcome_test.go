package app

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func readWelcomeState(t *testing.T, response *httptest.ResponseRecorder) welcomeState {
	t.Helper()
	status(t, response, 200)
	var state welcomeState
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func changeWelcome(t *testing.T, a *App, host *http.Cookie, revision int64, action string) welcomeState {
	t.Helper()
	return readWelcomeState(t, request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"revision": revision, "action": action}, host))
}

func assertWelcomeError(t *testing.T, response *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	status(t, response, wantStatus)
	var failure struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
		t.Fatal(err)
	}
	if failure.Code != wantCode {
		t.Fatalf("code=%q want=%q", failure.Code, wantCode)
	}
}

func TestWelcomeSequenceRevealsOnlyCurrentStepAndSurvivesRestart(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Welcome guest")
	initial := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
	if !initial.Open || initial.Revision != 0 || initial.CurrentStep != 0 || len(initial.Steps) != 0 {
		t.Fatalf("unexpected initial welcome state: %+v", initial)
	}
	steps := []welcomeStep{testWelcomeStep("  First instruction  ", "  Keep this text.\nTwo lines.  "), testWelcomeStep("Private future step", "Private future details")}
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": initial.Revision, "steps": steps}, host))
	if saved.Revision != 1 || saved.Steps[0].Widgets[0].Text != "First instruction" || saved.Steps[0].Widgets[1].Text != "Keep this text.\nTwo lines." {
		t.Fatalf("unexpected saved welcome state: %+v", saved)
	}
	waiting := changeWelcome(t, a, host, saved.Revision, "start")
	if waiting.Open || waiting.CurrentStep != 0 || waiting.Revision != 2 {
		t.Fatalf("unexpected waiting state: %+v", waiting)
	}
	assertView := func(application *App, wantStep int) {
		t.Helper()
		response := request(t, application, "GET", "/api/welcome", nil, visitor)
		status(t, response, 200)
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("welcome response must not be cached")
		}
		var view welcomeView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if wantStep == 0 && view.Step != nil {
			t.Fatalf("waiting or open response contains a step: %s", response.Body.String())
		}
		if wantStep > 0 && (view.Open || view.Step == nil || view.Step.Position != wantStep || view.Step.Widgets[0].Text != saved.Steps[wantStep-1].Widgets[0].Text || view.Step.Widgets[1].Text != saved.Steps[wantStep-1].Widgets[1].Text) {
			t.Fatalf("wrong visible step: %s", response.Body.String())
		}
		for i, step := range saved.Steps {
			if i+1 != wantStep && strings.Contains(response.Body.String(), step.Widgets[0].Text) {
				t.Fatalf("hidden step appeared in guest response: %s", response.Body.String())
			}
		}
		if strings.Contains(response.Body.String(), `"steps"`) {
			t.Fatal("guest received the administrator step collection")
		}
	}
	assertView(a, 0)
	first := changeWelcome(t, a, host, waiting.Revision, "next")
	selectGuestWelcomeStep(t, a, visitor, 1)
	assertView(a, 1)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(a.config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	reopened.now = a.now
	assertView(reopened, 1)
	second := changeWelcome(t, reopened, host, first.Revision, "next")
	selectGuestWelcomeStep(t, reopened, visitor, 2)
	assertView(reopened, 2)
	assertWelcomeError(t, request(t, reopened, "POST", "/api/admin/welcome/transition", map[string]any{"revision": second.Revision, "action": "next"}, host), 409, "invalid_welcome_transition")
	assertView(reopened, 2)
	opened := changeWelcome(t, reopened, host, second.Revision, "open")
	if !opened.Open || opened.CurrentStep != len(steps) || opened.Revision != second.Revision+1 {
		t.Fatalf("unexpected open state: %+v", opened)
	}
	moveGuestWelcome(t, reopened, visitor, "finish")
	assertView(reopened, 0)
	status(t, request(t, reopened, "GET", "/api/photos", nil, visitor), 200)
	changeWelcome(t, reopened, host, opened.Revision, "start")
	assertView(reopened, 0)
}

func TestWelcomeBlocksGuestContentAndMutationsButKeepsIdentity(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, guestIdentity, _ := guest(t, a, host, "Waiting guest")
	status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": "A private message"}, visitor), 201)
	changeWelcome(t, a, host, 0, "start")
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/party"}, {"HEAD", "/api/party"},
		{"GET", "/api/programme"}, {"HEAD", "/api/programme"},
		{"GET", "/api/guestbook"}, {"HEAD", "/api/guestbook"},
		{"POST", "/api/guestbook"}, {"DELETE", "/api/guestbook/1"},
		{"GET", "/api/photos"}, {"HEAD", "/api/photos"}, {"POST", "/api/photos"},
		{"GET", "/api/photos/1/image"}, {"HEAD", "/api/photos/1/image?thumbnail=1"},
		{"DELETE", "/api/photos/1"}, {"GET", "/api/uploads"},
		{"HEAD", "/api/uploads"}, {"GET", "/api/uploads/1"},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			response := request(t, a, route.method, route.path, nil, visitor)
			assertWelcomeError(t, response, http.StatusLocked, "welcome_required")
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("blocked content must not be cached")
			}
		})
	}
	for _, path := range []string{"/api/party", "/api/programme", "/api/guestbook", "/api/photos", "/api/uploads", "/api/admin/welcome"} {
		status(t, request(t, a, "GET", path, nil, host), 200)
	}
	status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": "The host can still post"}, host), 201)
	for _, path := range []string{"/api/session", "/api/welcome"} {
		status(t, request(t, a, "GET", path, nil, visitor), 200)
		status(t, request(t, a, "GET", path, nil, nil), 401)
	}
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/admin/welcome"}, {"PUT", "/api/admin/welcome"}, {"POST", "/api/admin/welcome/transition"},
	} {
		assertWelcomeError(t, request(t, a, route.method, route.path, nil, visitor), 403, "admin_required")
	}
	status(t, request(t, a, "POST", "/api/logout", map[string]any{}, visitor), 204)
	status(t, request(t, a, "GET", "/api/welcome", nil, visitor), 401)
	link := request(t, a, "POST", "/api/admin/guests/"+strconv.FormatInt(guestIdentity.ID, 10)+"/invitation", map[string]any{}, host)
	status(t, link, 200)
	lateVisitor, _, _ := guest(t, a, host, "Late guest")
	status(t, request(t, a, "GET", "/api/welcome", nil, lateVisitor), 200)
	assertWelcomeError(t, request(t, a, "GET", "/api/party", nil, lateVisitor), 423, "welcome_required")
}

func TestWelcomeEditsAndTransitionsEnforceRevisionAndBounds(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	validSteps := []welcomeStep{testWelcomeStep(strings.Repeat("é", 120), strings.Repeat("🙂", 1000))}
	for _, input := range []any{
		map[string]any{"revision": 0},
		map[string]any{"revision": 0, "steps": nil},
		map[string]any{"steps": validSteps},
		map[string]any{"revision": -1, "steps": validSteps},
		map[string]any{"revision": 0, "steps": make([]welcomeStep, 13)},
		map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("  ", "")}},
		map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep(strings.Repeat("é", 121), "")}},
		map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Title", strings.Repeat("🙂", 1001))}},
	} {
		assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", input, host), 400, "invalid_welcome_steps")
	}
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": validSteps}, host))
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{}}, host), 409, "welcome_conflict")
	for _, action := range []string{"next", "open", "unknown"} {
		assertWelcomeError(t, request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"revision": saved.Revision, "action": action}, host), 409, "invalid_welcome_transition")
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"action": "start"}, host), 400, "invalid_body")
	waiting := changeWelcome(t, a, host, saved.Revision, "start")
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"revision": waiting.Revision, "action": "start"}, host), 409, "invalid_welcome_transition")
	saved = readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": waiting.Revision, "steps": validSteps}, host))
	shown := changeWelcome(t, a, host, saved.Revision, "next")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": shown.Revision, "steps": []welcomeStep{}}, host), 409, "welcome_steps_locked")
	opened := changeWelcome(t, a, host, shown.Revision, "open")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": opened.Revision, "steps": []welcomeStep{}}, host), 409, "welcome_steps_locked")
	waiting = changeWelcome(t, a, host, opened.Revision, "start")
	waiting = readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": waiting.Revision, "steps": []welcomeStep{}}, host))
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"revision": waiting.Revision, "action": "next"}, host), 409, "invalid_welcome_transition")
	changeWelcome(t, a, host, waiting.Revision, "open")
}

func TestConcurrentWelcomeAdvanceCannotSkipSteps(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("First", ""), testWelcomeStep("Second", "")}}, host))
	waiting := changeWelcome(t, a, host, saved.Revision, "start")
	var group sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		group.Go(func() {
			results <- request(t, a, "POST", "/api/admin/welcome/transition", map[string]any{"revision": waiting.Revision, "action": "next"}, host)
		})
	}
	group.Wait()
	close(results)
	counts := map[int]int{}
	for response := range results {
		counts[response.Code]++
		if response.Code == 409 {
			assertWelcomeError(t, response, 409, "welcome_conflict")
		}
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("expected one advance and one conflict, got %v", counts)
	}
	state := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
	if state.CurrentStep != 1 || state.Revision != waiting.Revision+1 || state.Open {
		t.Fatalf("concurrent advances skipped a step: %+v", state)
	}
}

func TestWelcomeClosurePreservesAcceptedUploadsWithoutExposingThem(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, identity, _ := guest(t, a, host, "Uploading guest")
	id, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	accepted := queuedUpload(t, a, visitor, id, pngBytes(t))
	status(t, accepted, 202)
	waiting := changeWelcome(t, a, host, 0, "start")
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(t.Context(), job)
	completed, err := a.uploadByID(t.Context(), job.id, identity.ID)
	if err != nil || completed.Status != "ready" || completed.Photo != nil {
		t.Fatalf("accepted upload did not complete privately: job=%+v error=%v", completed, err)
	}
	var photo Photo
	if err := a.db.QueryRow("SELECT photo_id FROM upload_jobs WHERE id=$1", job.id).Scan(&photo.ID); err != nil {
		t.Fatal(err)
	}
	photo.urls()
	assertWelcomeError(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.id, 10), nil, visitor), 423, "welcome_required")
	for _, path := range []string{photo.URL, photo.ThumbnailURL} {
		for _, header := range []struct{ name, value string }{{"Range", "bytes=0-3"}, {"If-Modified-Since", "Thu, 01 Jan 2099 00:00:00 GMT"}} {
			r := httptest.NewRequest("GET", path, nil)
			r.AddCookie(visitor)
			r.Header.Set(header.name, header.value)
			response := httptest.NewRecorder()
			a.Handler().ServeHTTP(response, r)
			assertWelcomeError(t, response, 423, "welcome_required")
		}
		status(t, request(t, a, "GET", path, nil, host), 200)
	}
	newID, err := newUploadID()
	if err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, queuedUpload(t, a, visitor, newID, pngBytes(t)), 423, "welcome_required")
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM upload_jobs").Scan(&count); err != nil || count != 1 {
		t.Fatalf("closed welcome accepted a new upload: count=%d error=%v", count, err)
	}
	changeWelcome(t, a, host, waiting.Revision, "open")
	status(t, request(t, a, "GET", photo.URL, nil, visitor), 200)
	status(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.id, 10), nil, visitor), 200)
}

type welcomeClosureReader struct {
	io.Reader
	onRead func()
	once   sync.Once
}

func testWelcomeStep(title, body string, widgets ...welcomeWidget) welcomeStep {
	step := welcomeStep{Widgets: []welcomeWidget{{Type: "title", Text: title}}}
	if body != "" {
		step.Widgets = append(step.Widgets, welcomeWidget{Type: "text", Text: body})
	}
	step.Widgets = append(step.Widgets, widgets...)
	return step
}

func (r *welcomeClosureReader) Read(p []byte) (int, error) {
	r.once.Do(r.onRead)
	return r.Reader.Read(p)
}

func TestWelcomeClosureDuringReceptionRejectsNewGuestUpload(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Guest sending a file")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(pngBytes(t)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader := &welcomeClosureReader{Reader: &body, onRead: func() {
		changeWelcome(t, a, host, 0, "start")
	}}
	r := httptest.NewRequest("POST", "/api/photos", reader)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.AddCookie(visitor)
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, r)
	assertWelcomeError(t, response, 423, "welcome_required")
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM upload_jobs").Scan(&count); err != nil || count != 0 {
		t.Fatalf("in-flight upload was accepted after closing: count=%d error=%v", count, err)
	}
	for _, directory := range []string{"tmp", "uploads"} {
		files, err := os.ReadDir(filepath.Join(a.config.DataDir, directory))
		if err != nil || len(files) != 0 {
			t.Fatalf("rejected upload retained %s files: count=%d error=%v", directory, len(files), err)
		}
	}
	status(t, upload(t, a, host, pngBytes(t)), 201)
}
