package app

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestWelcomeMediaSettingsAreTypedAndValidated(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	for _, test := range []struct{ name, step, code string }{
		{"missing settings", `{"action":"media_upload"}`, "invalid_welcome_action"},
		{"null settings", `{"action":"media_upload","mediaUpload":null}`, "invalid_welcome_action"},
		{"missing category", `{"action":"media_upload","mediaUpload":{}}`, "invalid_body"},
		{"negative category", `{"action":"media_upload","mediaUpload":{"categoryId":-1}}`, "invalid_welcome_action"},
		{"string category", `{"action":"media_upload","mediaUpload":{"categoryId":"1"}}`, "invalid_body"},
		{"boolean category", `{"action":"media_upload","mediaUpload":{"categoryId":true}}`, "invalid_body"},
		{"fractional category", `{"action":"media_upload","mediaUpload":{"categoryId":1.5}}`, "invalid_body"},
		{"unknown setting", `{"action":"media_upload","mediaUpload":{"categoryId":null,"guestId":2}}`, "invalid_body"},
		{"profile settings", `{"action":"profile_photo","mediaUpload":{"categoryId":null}}`, "invalid_welcome_action"},
		{"plain settings", `{"action":null,"mediaUpload":{"categoryId":null}}`, "invalid_welcome_action"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"revision":0,"steps":[{"title":"Upload","body":"",` + strings.TrimPrefix(test.step, "{") + `]}`
			r := httptest.NewRequest("PUT", "/api/admin/welcome", strings.NewReader(body))
			r.Header.Set("X-Requested-With", "birthday-party")
			r.AddCookie(host)
			assertWelcomeError(t, performMediaUpload(a, r), 400, test.code)
		})
	}
	missing := int64(99999)
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{{Title: "Upload", Action: ptr("media_upload"), MediaUpload: &welcomeMediaUpload{CategoryID: &missing}}}}, host), 404, "media_category_not_found")
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{{Title: "Profile", Action: ptr("profile_photo")}, {Title: "Main gallery", Action: ptr("media_upload"), MediaUpload: &welcomeMediaUpload{}}}}, host))
	if state.Steps[0].MediaUpload != nil || state.Steps[1].MediaUpload == nil || state.Steps[1].MediaUpload.CategoryID != nil {
		t.Fatal("optional typed settings did not round trip")
	}
}

func TestWelcomeMediaUploadIsScopedPrivateAndPersistent(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Welcome uploader")
	other, _, _ := guest(t, a, host, "Other guest")
	category := createTestCategory(t, a, host, "Hidden contributions", false)
	steps := []welcomeStep{
		{Title: "Introduction"},
		{Title: "Send a memory", Action: ptr("media_upload"), MediaUpload: &welcomeMediaUpload{CategoryID: &category.ID}},
		{Title: "A later gallery upload", Action: ptr("media_upload"), MediaUpload: &welcomeMediaUpload{}},
		{Title: "Next instruction"},
	}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	for range 2 {
		assertWelcomeError(t, request(t, a, "GET", "/api/welcome/upload-context", nil, visitor), 423, "welcome_required")
		view := request(t, a, "GET", "/api/welcome", nil, visitor)
		if strings.Contains(view.Body.String(), "mediaUpload") || strings.Contains(view.Body.String(), steps[2].Title) {
			t.Fatal("future media action leaked")
		}
		state = changeWelcome(t, a, host, state.Revision, "next")
	}
	context := request(t, a, "GET", "/api/welcome/upload-context", nil, visitor)
	status(t, context, 200)
	var uploadContext struct {
		Revision int64            `json:"revision"`
		Category MediaCategory    `json:"category"`
		Limits   map[string]int64 `json:"limits"`
	}
	if err := json.Unmarshal(context.Body.Bytes(), &uploadContext); err != nil {
		t.Fatal(err)
	}
	if uploadContext.Revision != state.Revision || uploadContext.Category.ID != category.ID || uploadContext.Category.IsPublic || uploadContext.Limits["videoBytes"] != a.config.MaxVideoBytes {
		t.Fatalf("wrong upload context: %s", context.Body.String())
	}
	for _, path := range []string{"/api/photos", "/api/party", "/api/programme", "/api/guestbook", "/api/profile", "/api/media-categories"} {
		assertWelcomeError(t, request(t, a, "GET", path, nil, visitor), 423, "welcome_required")
	}
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, nil, "")), 400, "invalid_body")
	wrongCategory := int64(99999)
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, &wrongCategory, &state.Revision, "")), 400, "invalid_media_category")
	clientID := "11111111-1111-4111-8111-111111111111"
	accepted := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &state.Revision, clientID))
	status(t, accepted, 202)
	job := parseJob(t, accepted)
	if !sameOptionalID(job.CategoryID, &category.ID) || !sameOptionalID(job.WelcomeRevision, &state.Revision) {
		t.Fatal("welcome destination was not forced into the job")
	}
	if retry := parseJob(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &state.Revision, clientID))); retry.ID != job.ID {
		t.Fatal("same welcome retry created another job")
	}
	photo := finishCategoryUpload(t, a, accepted)
	if !sameOptionalID(photo.CategoryID, &category.ID) {
		t.Fatal("worker lost the persisted category")
	}
	jobPath := "/api/uploads/" + strconv.FormatInt(job.ID, 10)
	if ready := parseJob(t, request(t, a, "GET", jobPath, nil, visitor)); ready.Status != "ready" || ready.Photo != nil {
		t.Fatal("closed queue exposed media")
	}
	status(t, request(t, a, "GET", jobPath, nil, other), 404)
	for _, path := range []string{photo.URL, photo.ThumbnailURL} {
		assertWelcomeError(t, request(t, a, "GET", path, nil, visitor), 423, "welcome_required")
		status(t, request(t, a, "GET", path, nil, host), 200)
	}
	previousRevision := state.Revision
	state = changeWelcome(t, a, host, state.Revision, "next")
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &previousRevision, clientID)), 409, "welcome_conflict")
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &state.Revision, clientID)), 409, "welcome_conflict")
	mainAccepted := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &state.Revision, ""))
	status(t, mainAccepted, 202)
	// Restart before processing: destination and welcome revision are durable.
	config, clock := a.config, a.now
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.now = clock
	a = reopened
	main := finishCategoryUpload(t, a, mainAccepted)
	if main.CategoryID != nil {
		t.Fatal("main-gallery upload gained a category after restart")
	}
	state = changeWelcome(t, a, host, state.Revision, "open")
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &previousRevision, clientID)), 409, "welcome_conflict")
	status(t, request(t, a, "GET", photo.URL, nil, visitor), 404)
	status(t, request(t, a, "GET", main.URL, nil, visitor), 200)
	if parseJob(t, request(t, a, "GET", jobPath, nil, visitor)).Photo != nil {
		t.Fatal("private category became visible when welcome opened")
	}
	status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": true}, host), 200)
	status(t, request(t, a, "GET", photo.URL, nil, visitor), 200)
	if parseJob(t, request(t, a, "GET", jobPath, nil, visitor)).Photo == nil {
		t.Fatal("published contribution did not become visible")
	}
}

func TestWelcomeMediaUploadRejectsLateAcceptance(t *testing.T) {
	for _, ending := range []string{"plain step", "another upload step", "open", "logout", "revoke"} {
		t.Run(ending, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, identity, _ := guest(t, a, host, "Uploading guest")
			next := welcomeStep{Title: "Next"}
			if ending == "another upload step" {
				next.Action = ptr("media_upload")
				next.MediaUpload = &welcomeMediaUpload{}
			}
			state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{{Title: "Upload", Action: ptr("media_upload"), MediaUpload: &welcomeMediaUpload{}}, next}}, host))
			state = changeWelcome(t, a, host, state.Revision, "start")
			state = changeWelcome(t, a, host, state.Revision, "next")
			r := mediaUploadRequest(t, visitor, nil, &state.Revision, "")
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch ending {
				case "plain step", "another upload step":
					changeWelcome(t, a, host, state.Revision, "next")
				case "open":
					changeWelcome(t, a, host, state.Revision, "open")
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
				case "revoke":
					status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
				}
			}})
			response := performMediaUpload(a, r)
			if ending == "logout" || ending == "revoke" {
				status(t, response, 401)
			} else {
				assertWelcomeError(t, response, 409, "welcome_conflict")
			}
			assertNoAcceptedMedia(t, a)
		})
	}
}

func TestMediaCategoryVideoRangesFollowVisibility(t *testing.T) {
	data := videoFixture(t, "mp4")
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Video viewer")
	category := createTestCategory(t, a, host, "Private video", false)
	r := avatarRequest(t, host, data)
	r.Method = "POST"
	r.URL.Path = "/api/photos"
	r.URL.RawQuery = "categoryId=" + strconv.FormatInt(category.ID, 10)
	photo := finishCategoryUpload(t, a, performMediaUpload(a, r))
	if photo.Kind != "video" {
		t.Fatal("video upload lost its media type")
	}
	for _, public := range []bool{false, true, false} {
		status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": public}, host), 200)
		rangeRequest := httptest.NewRequest("GET", photo.URL, nil)
		rangeRequest.AddCookie(visitor)
		rangeRequest.Header.Set("Range", "bytes=0-31")
		response := performMediaUpload(a, rangeRequest)
		if public {
			status(t, response, 206)
			if response.Body.Len() != 32 || response.Header().Get("Content-Type") != "video/mp4" {
				t.Fatal("invalid public category video range")
			}
			status(t, request(t, a, "HEAD", photo.URL, nil, visitor), 200)
			status(t, request(t, a, "GET", photo.ThumbnailURL, nil, visitor), 200)
		} else {
			assertWelcomeError(t, response, 404, "photo_not_found")
			status(t, request(t, a, "HEAD", photo.URL, nil, visitor), 404)
			status(t, request(t, a, "GET", photo.ThumbnailURL, nil, visitor), 404)
		}
	}
}

func TestMediaCategoryMigrationPreservesExistingMediaAndWelcome(t *testing.T) {
	db := testDatabase(t)
	files := migrationFiles(t)
	delete(files, "migrations/0006_media_categories.sql")
	if err := applyMigrations(t.Context(), db, files); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`INSERT INTO guests(id,name,role) VALUES(1,'Existing guest','guest')`,
		`INSERT INTO photos(id,guest_id,width,height,created_at,filename,thumbnail,mime,byte_size) VALUES(1,1,12,12,'2026-10-15T12:00:00Z','existing.png','existing.jpg','image/png',100)`,
		`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,photo_id) VALUES(1,'existing-id','ready','existing.png','image','png','existing-key',100,'2026-10-15T12:00:00Z','2026-10-15T12:00:00Z',1)`,
		`UPDATE welcome SET is_open=false,revision=8,current_step=1,steps='[{"title":"Existing step","body":"Keep this text","action":"profile_photo"}]'::jsonb`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	var before string
	if err := db.QueryRow("SELECT row_to_json(welcome)::text FROM welcome").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := db.QueryRow("SELECT row_to_json(welcome)::text FROM welcome").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("category migration changed existing welcome content or progress")
	}
	var unchanged bool
	if err := db.QueryRow("SELECT p.category_id IS NULL AND j.category_id IS NULL AND j.welcome_revision IS NULL AND p.filename='existing.png' FROM photos p JOIN upload_jobs j ON j.photo_id=p.id").Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("existing media migration failed: %v", err)
	}
}
