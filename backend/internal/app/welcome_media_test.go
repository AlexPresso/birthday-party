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
		{"missing settings", `{"type":"media_upload"}`, "invalid_welcome_action"},
		{"null settings", `{"type":"media_upload","mediaUpload":null}`, "invalid_welcome_action"},
		{"missing category", `{"type":"media_upload","mediaUpload":{}}`, "invalid_body"},
		{"negative category", `{"type":"media_upload","mediaUpload":{"categoryId":-1}}`, "invalid_welcome_action"},
		{"string category", `{"type":"media_upload","mediaUpload":{"categoryId":"1"}}`, "invalid_body"},
		{"boolean category", `{"type":"media_upload","mediaUpload":{"categoryId":true}}`, "invalid_body"},
		{"fractional category", `{"type":"media_upload","mediaUpload":{"categoryId":1.5}}`, "invalid_body"},
		{"unknown setting", `{"type":"media_upload","mediaUpload":{"categoryId":null,"guestId":2}}`, "invalid_body"},
		{"profile settings", `{"type":"profile_photo","mediaUpload":{"categoryId":null}}`, "invalid_body"},
		{"plain settings", `{"type":"text","mediaUpload":{"categoryId":null}}`, "invalid_body"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"revision":0,"steps":[{"widgets":[` + test.step + `]}]}`
			r := httptest.NewRequest("PUT", "/api/admin/welcome", strings.NewReader(body))
			r.Header.Set("X-Requested-With", "birthday-party")
			r.AddCookie(host)
			assertWelcomeError(t, performMediaUpload(a, r), 400, test.code)
		})
	}
	missing := int64(99999)
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Upload", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &missing}})}}, host), 404, "media_category_not_found")
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Profile", "", welcomeWidget{Type: "profile_photo"}), testWelcomeStep("Main gallery", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}})}}, host))
	if state.Steps[0].Widgets[1].MediaUpload != nil || state.Steps[1].Widgets[1].MediaUpload == nil || state.Steps[1].Widgets[1].MediaUpload.CategoryID != nil {
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
		testWelcomeStep("Introduction", ""),
		testWelcomeStep("Send a memory", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{CategoryID: &category.ID}}),
		testWelcomeStep("A later gallery upload", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}}),
		testWelcomeStep("Next instruction", ""),
	}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	for range 2 {
		assertWelcomeError(t, request(t, a, "GET", "/api/welcome/upload-context?widgetIndex=1", nil, visitor), 423, "welcome_required")
		view := request(t, a, "GET", "/api/welcome", nil, visitor)
		if strings.Contains(view.Body.String(), "mediaUpload") || strings.Contains(view.Body.String(), steps[2].Widgets[0].Text) {
			t.Fatal("future media action leaked")
		}
		state = changeWelcome(t, a, host, state.Revision, "next")
	}
	progressRevision := selectGuestWelcomeStep(t, a, visitor, 2).ProgressRevision
	selectGuestWelcomeStep(t, a, other, 2)
	context := request(t, a, "GET", "/api/welcome/upload-context?widgetIndex=1", nil, visitor)
	status(t, context, 200)
	var uploadContext struct {
		Revision int64            `json:"revision"`
		Category MediaCategory    `json:"category"`
		Limits   map[string]int64 `json:"limits"`
	}
	if err := json.Unmarshal(context.Body.Bytes(), &uploadContext); err != nil {
		t.Fatal(err)
	}
	if uploadContext.Revision != progressRevision || uploadContext.Category.ID != category.ID || uploadContext.Category.IsPublic || uploadContext.Limits["videoBytes"] != a.config.MaxVideoBytes {
		t.Fatalf("wrong upload context: %s", context.Body.String())
	}
	for _, path := range []string{"/api/photos", "/api/party", "/api/programme", "/api/guestbook", "/api/profile", "/api/media-categories"} {
		assertWelcomeError(t, request(t, a, "GET", path, nil, visitor), 423, "welcome_required")
	}
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, nil, "")), 400, "invalid_body")
	wrongCategory := int64(99999)
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, &wrongCategory, &progressRevision, "")), 400, "invalid_media_category")
	clientID := "11111111-1111-4111-8111-111111111111"
	accepted := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, clientID))
	status(t, accepted, 202)
	job := parseJob(t, accepted)
	if !sameOptionalID(job.CategoryID, &category.ID) || !sameOptionalID(job.WelcomeRevision, &progressRevision) {
		t.Fatal("welcome destination was not forced into the job")
	}
	if retry := parseJob(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, clientID))); retry.ID != job.ID {
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
	previousRevision := progressRevision
	state = changeWelcome(t, a, host, state.Revision, "next")
	if retry := parseJob(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, clientID))); retry.ID != job.ID {
		t.Fatal("host unlock invalidated a current upload context")
	}
	progressRevision = moveGuestWelcome(t, a, visitor, "next").ProgressRevision
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &previousRevision, clientID)), 409, "welcome_conflict")
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, clientID)), 409, "welcome_conflict")
	mainAccepted := performMediaUpload(a, mediaUploadRequest(t, visitor, nil, &progressRevision, ""))
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
	if parseJob(t, request(t, a, "GET", jobPath, nil, visitor)).Photo != nil {
		t.Fatal("host opening exposed media before guest completion")
	}
	moveGuestWelcome(t, a, visitor, "finish")
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
	for _, ending := range []string{"plain step", "another upload step", "unlock", "open", "finish", "logout", "revoke"} {
		t.Run(ending, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, identity, _ := guest(t, a, host, "Uploading guest")
			next := testWelcomeStep("Next", "")
			if ending == "another upload step" {
				next.Widgets = append(next.Widgets, welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}})
			}
			state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Upload", "", welcomeWidget{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}}), next}}, host))
			state = changeWelcome(t, a, host, state.Revision, "start")
			state = changeWelcome(t, a, host, state.Revision, "next")
			progressRevision := selectGuestWelcomeStep(t, a, visitor, 1).ProgressRevision
			r := mediaUploadRequest(t, visitor, nil, &progressRevision, "")
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch ending {
				case "plain step", "another upload step":
					changeWelcome(t, a, host, state.Revision, "next")
					moveGuestWelcome(t, a, visitor, "next")
				case "unlock":
					changeWelcome(t, a, host, state.Revision, "next")
				case "open", "finish":
					changeWelcome(t, a, host, state.Revision, "open")
					if ending == "finish" {
						moveGuestWelcome(t, a, visitor, "finish")
					}
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
				case "revoke":
					status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
				}
			}})
			response := performMediaUpload(a, r)
			if ending == "logout" || ending == "revoke" {
				status(t, response, 401)
			} else if ending == "unlock" || ending == "open" {
				status(t, response, 202)
			} else {
				assertWelcomeError(t, response, 409, "welcome_conflict")
			}
			if ending != "unlock" && ending != "open" {
				assertNoAcceptedMedia(t, a)
			}
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
