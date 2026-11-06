package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func readGuestWelcome(t *testing.T, a *App, visitor *http.Cookie) welcomeView {
	t.Helper()
	response := request(t, a, "GET", "/api/welcome", nil, visitor)
	status(t, response, 200)
	var view welcomeView
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	return view
}

func moveGuestWelcome(t *testing.T, a *App, visitor *http.Cookie, action string) welcomeView {
	t.Helper()
	view := readGuestWelcome(t, a, visitor)
	response := request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": view.ProgressRevision, "action": action}, visitor)
	status(t, response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	return view
}

func selectGuestWelcomeStep(t *testing.T, a *App, visitor *http.Cookie, position int) welcomeView {
	t.Helper()
	view := readGuestWelcome(t, a, visitor)
	for range 13 {
		current := 0
		if view.Step != nil {
			current = view.Step.Position
		}
		if current == position {
			return view
		}
		action := "next"
		if current > position {
			action = "previous"
		}
		view = moveGuestWelcome(t, a, visitor, action)
	}
	t.Fatal("guest did not reach the requested welcome step")
	return view
}

func setWelcomeRequired(t *testing.T, a *App, host *http.Cookie, state welcomeState, required bool) welcomeState {
	t.Helper()
	return readWelcomeState(t, request(t, a, "PATCH", "/api/admin/welcome/required", map[string]any{"revision": state.Revision, "required": required}, host))
}

func TestGuestWelcomeProgressRemainsIndependentOfHostUnlocks(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, firstIdentity, _ := guest(t, a, host, "First participant")
	second, _, _ := guest(t, a, host, "Second participant")
	steps := []welcomeStep{testWelcomeStep("First", ""), testWelcomeStep("Second", ""), testWelcomeStep("Still locked", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	firstView := readGuestWelcome(t, a, first)
	secondView := readGuestWelcome(t, a, second)
	if firstView.Open || firstView.Step != nil || firstView.CanNext || firstView.CanFinish {
		t.Fatalf("unexpected waiting view: %+v", firstView)
	}
	state = changeWelcome(t, a, host, state.Revision, "next")
	waitingRevision := firstView.ProgressRevision
	firstView = readGuestWelcome(t, a, first)
	if firstView.Step == nil || firstView.Step.Position != 1 || firstView.CanNext || firstView.CanPrevious || firstView.ProgressRevision <= waitingRevision {
		t.Fatalf("first unlock did not enter the first step automatically: %+v", firstView)
	}
	var position int
	var revision int64
	if err := a.db.QueryRow("SELECT position,revision FROM guest_welcome_progress WHERE guest_id=$1", firstIdentity.ID).Scan(&position, &revision); err != nil {
		t.Fatal(err)
	}
	if position != 1 || revision != firstView.ProgressRevision {
		t.Fatalf("first step was returned before progress was persisted: position=%d revision=%d", position, revision)
	}
	if repeated := readGuestWelcome(t, a, first); repeated.Step == nil || repeated.Step.Position != 1 || repeated.ProgressRevision != firstView.ProgressRevision {
		t.Fatalf("refresh changed the automatically selected step: %+v", repeated)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": waitingRevision, "action": "next"}, first), 409, "welcome_conflict")
	state = changeWelcome(t, a, host, state.Revision, "next")
	if view := readGuestWelcome(t, a, first); view.Step == nil || view.Step.Position != 1 || view.ProgressRevision != firstView.ProgressRevision || !view.CanNext {
		t.Fatalf("later unlock changed an active step: %+v", view)
	}
	if view := readGuestWelcome(t, a, second); view.Step == nil || view.Step.Position != 1 || view.ProgressRevision <= secondView.ProgressRevision || !view.CanNext {
		t.Fatalf("a participant who missed unlocks did not start at the first step: %+v", view)
	}
	firstView = moveGuestWelcome(t, a, first, "next")
	if firstView.Step.Position != 2 || !firstView.CanPrevious || firstView.CanNext {
		t.Fatalf("wrong independent progress: %+v", firstView)
	}
	response := request(t, a, "GET", "/api/welcome", nil, first)
	if strings.Contains(response.Body.String(), "Still locked") || strings.Contains(response.Body.String(), `"steps"`) {
		t.Fatal("future steps appeared in the guest response")
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": firstView.ProgressRevision, "action": "next"}, first), 409, "invalid_welcome_transition")
	back := moveGuestWelcome(t, a, first, "previous")
	if back.Step.Position != 1 || back.ProgressRevision <= firstView.ProgressRevision || back.CanPrevious {
		t.Fatalf("previous did not preserve an ordered progression: %+v", back)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": firstView.ProgressRevision, "action": "previous"}, first), 409, "welcome_conflict")
	state = changeWelcome(t, a, host, state.Revision, "open")
	if state.CurrentStep != len(steps) {
		t.Fatal("opening did not unlock all steps")
	}
	assertWelcomeError(t, request(t, a, "GET", "/api/photos", nil, first), 423, "welcome_required")
	if view := moveGuestWelcome(t, a, first, "finish"); !view.Open || view.Step != nil || view.CanNext || view.CanPrevious || view.CanFinish || view.ProgressRevision <= back.ProgressRevision {
		t.Fatalf("unexpected completed view: %+v", view)
	}
	status(t, request(t, a, "GET", "/api/photos", nil, first), 200)
	assertWelcomeError(t, request(t, a, "GET", "/api/photos", nil, second), 423, "welcome_required")
}

func TestRequiredWelcomeAppliesToLateGuestsAndPersistsCompletion(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	photo := finishCategoryUpload(t, a, performMediaUpload(a, mediaUploadRequest(t, host, nil, nil, "")))
	steps := []welcomeStep{testWelcomeStep("One", ""), testWelcomeStep("Two", ""), testWelcomeStep("Three", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = setWelcomeRequired(t, a, host, state, true)
	beforeStart, _, _ := guest(t, a, host, "Before the welcome")
	status(t, request(t, a, "GET", "/api/photos", nil, beforeStart), 200)
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "open")
	late, _, _ := guest(t, a, host, "Late required participant")
	for _, path := range []string{"/api/photos", "/api/party", "/api/guestbook", "/api/profile", "/api/uploads"} {
		assertWelcomeError(t, request(t, a, "GET", path, nil, late), 423, "welcome_required")
	}
	for _, path := range []string{photo.URL, photo.ThumbnailURL} {
		for _, method := range []string{"GET", "HEAD"} {
			protected := httptest.NewRequest(method, path, nil)
			protected.AddCookie(late)
			protected.Header.Set("Range", "bytes=0-15")
			assertWelcomeError(t, performMediaUpload(a, protected), 423, "welcome_required")
		}
	}
	view := readGuestWelcome(t, a, late)
	if view.Open || view.Step == nil || view.Step.Position != 1 || view.CanFinish {
		t.Fatalf("late required guest skipped steps: %+v", view)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": view.ProgressRevision, "action": "finish"}, late), 409, "invalid_welcome_transition")
	view = selectGuestWelcomeStep(t, a, late, 3)
	if !view.CanFinish {
		t.Fatal("the final unlocked step cannot be completed")
	}
	view = moveGuestWelcome(t, a, late, "finish")
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
	if restored := readGuestWelcome(t, reopened, late); !restored.Open || restored.ProgressRevision != view.ProgressRevision {
		t.Fatalf("completion was lost on restart: %+v", restored)
	}
	status(t, request(t, reopened, "GET", "/api/photos", nil, late), 200)
	status(t, request(t, reopened, "GET", photo.URL, nil, late), 200)
	state = readWelcomeState(t, request(t, reopened, "PUT", "/api/admin/welcome", map[string]any{"revision": state.Revision, "steps": steps}, host))
	if edited := readGuestWelcome(t, reopened, late); !edited.Open || edited.ProgressRevision != view.ProgressRevision {
		t.Fatalf("saving welcome steps reset completed progress: %+v", edited)
	}
	state = changeWelcome(t, reopened, host, state.Revision, "start")
	if restarted := readGuestWelcome(t, reopened, late); restarted.Open || restarted.Step != nil || restarted.ProgressRevision <= view.ProgressRevision {
		t.Fatalf("new run did not reset progress safely: %+v", restarted)
	}
}

func TestGuestWelcomeProgressMigrationPreservesActiveStepsAndUploadTokens(t *testing.T) {
	db := testDatabase(t)
	files := migrationFiles(t)
	delete(files, "migrations/0008_guest_welcome_progress.sql")
	delete(files, "migrations/0009_notifications.sql")
	delete(files, "migrations/0010_programme_activities.sql")
	delete(files, "migrations/0011_programme_activity_events.sql")
	delete(files, "migrations/0012_product_configuration.sql")
	delete(files, "migrations/0013_question_activities.sql")
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO guests(id,name,role) VALUES(1,'Present guest','guest'),(2,'Future guest','guest')`,
		`INSERT INTO sessions(token_hash,guest_id,created_at,expires_at) VALUES('test-session',1,1,9999999999)`,
		`UPDATE welcome SET is_open=false,revision=15,current_step=2,steps='[{"widgets":[{"type":"text","text":"First"}]},{"widgets":[{"type":"media_upload","mediaUpload":{"categoryId":null}}]}]'::jsonb`,
		`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,welcome_revision,welcome_widget_index) VALUES(1,'accepted-id','queued','image.png','image','png','accepted-key',100,'2026-10-17T12:00:00Z','2026-10-17T12:00:00Z',18,0)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := migrate(t.Context(), db); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var position int
	var generation, revision int64
	if err := db.QueryRow("SELECT generation,position,revision FROM guest_welcome_progress WHERE guest_id=1").Scan(&generation, &position, &revision); err != nil {
		t.Fatal(err)
	}
	if generation != 1 || position != 2 || revision <= 18 {
		t.Fatalf("migration lost progress or reused an accepted upload token: generation=%d position=%d revision=%d", generation, position, revision)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM guest_welcome_progress").Scan(&count); err != nil || count != 1 {
		t.Fatalf("migration enrolled guests without sessions: count=%d error=%v", count, err)
	}
	var preserved bool
	if err := db.QueryRow("SELECT status='queued' AND welcome_revision=18 AND welcome_widget_index=0 AND storage_key='accepted-key' FROM upload_jobs").Scan(&preserved); err != nil || !preserved {
		t.Fatalf("migration changed an accepted upload: preserved=%v error=%v", preserved, err)
	}
	if _, err := db.Exec("UPDATE welcome SET is_open=true WHERE id=1"); err != nil {
		t.Fatalf("opening cannot retain the unlocked boundary: %v", err)
	}
}

func TestOptionalWelcomeLateArrivalAndRequiredToggle(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	steps := []welcomeStep{testWelcomeStep("One", ""), testWelcomeStep("Two", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "next")
	state = changeWelcome(t, a, host, state.Revision, "next")
	late, _, _ := guest(t, a, host, "Optional late participant")
	view := readGuestWelcome(t, a, late)
	if view.Step == nil || view.Step.Position != 2 {
		t.Fatal("optional late participant did not start at the unlocked boundary")
	}
	state = setWelcomeRequired(t, a, host, state, true)
	if updated := readGuestWelcome(t, a, late); updated.Step.Position != 2 || updated.ProgressRevision != view.ProgressRevision {
		t.Fatal("changing the requirement reset existing progress")
	}
	state = setWelcomeRequired(t, a, host, state, false)
	state = changeWelcome(t, a, host, state.Revision, "open")
	afterOpen, _, _ := guest(t, a, host, "After opening")
	status(t, request(t, a, "GET", "/api/photos", nil, afterOpen), 200)
	if !readGuestWelcome(t, a, afterOpen).Open {
		t.Fatal("optional late arrival was forced through completed welcome")
	}
	assertWelcomeError(t, request(t, a, "GET", "/api/photos", nil, late), 423, "welcome_required")
	moveGuestWelcome(t, a, late, "finish")
}

func TestConcurrentGuestWelcomeNavigationAcceptsOneCommand(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Concurrent participant")
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("First", ""), testWelcomeStep("Second", "")}}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	readGuestWelcome(t, a, visitor)
	state = changeWelcome(t, a, host, state.Revision, "open")
	view := readGuestWelcome(t, a, visitor)
	var results [2]*httptest.ResponseRecorder
	var group sync.WaitGroup
	for i := range results {
		group.Go(func() {
			results[i] = request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": view.ProgressRevision, "action": "next"}, visitor)
		})
	}
	group.Wait()
	if results[0].Code+results[1].Code != 200+409 {
		t.Fatalf("duplicate navigation statuses: %d, %d", results[0].Code, results[1].Code)
	}
	if current := readGuestWelcome(t, a, visitor); current.Step == nil || current.Step.Position != 2 {
		t.Fatalf("concurrent commands skipped a step: %+v", current)
	}
}
