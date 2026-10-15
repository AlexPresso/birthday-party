package app

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestWelcomeActionsValidateAndPreserveOptionalInput(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	for _, test := range []struct {
		name   string
		action any
		code   string
	}{
		{"unknown", "gallery", "invalid_welcome_action"},
		{"empty", "", "invalid_welcome_action"},
		{"whitespace", " profile_photo ", "invalid_welcome_action"},
		{"boolean", true, "invalid_body"},
		{"number", 1, "invalid_body"},
		{"object", map[string]string{"type": "profile_photo"}, "invalid_body"},
		{"list", []string{"profile_photo"}, "invalid_body"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := request(t, a, "PUT", "/api/admin/welcome", map[string]any{
				"revision": 0,
				"steps":    []map[string]any{{"title": "A step", "body": "A message", "action": test.action}},
			}, host)
			assertWelcomeError(t, response, 400, test.code)
			state := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
			if state.Revision != 0 || len(state.Steps) != 0 {
				t.Fatal("invalid action changed the welcome sequence")
			}
		})
	}
	response := request(t, a, "PUT", "/api/admin/welcome", map[string]any{
		"revision": 0,
		"steps": []map[string]any{
			{"title": "Old client", "body": "An authored instruction"},
			{"title": "No action", "body": "Another instruction", "action": nil},
			{"title": "Choose a photo", "body": "A personal instruction", "action": "profile_photo"},
		},
	}, host)
	state := readWelcomeState(t, response)
	if len(state.Steps) != 3 || state.Steps[0].Action != nil || state.Steps[1].Action != nil || state.Steps[2].Action == nil || *state.Steps[2].Action != "profile_photo" || strings.Count(response.Body.String(), `"action":null`) != 2 {
		t.Fatalf("optional action contract changed: %s", response.Body.String())
	}
}

func TestWelcomeProfileActionRevealsOnlyCurrentStepAndPersists(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Welcome action guest")
	steps := []welcomeStep{
		{Title: "First instruction", Body: "First text"},
		{Title: "A personal photo", Body: "Photo instruction", Action: ptr("profile_photo")},
		{Title: "Hidden final step", Body: "Private final details"},
	}
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	waiting := changeWelcome(t, a, host, saved.Revision, "start")
	for _, stage := range []int{0, 1, 2} {
		if stage > 0 {
			waiting = changeWelcome(t, a, host, waiting.Revision, "next")
		}
		response := request(t, a, "GET", "/api/welcome", nil, visitor)
		status(t, response, 200)
		var view welcomeView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if view.Open || view.Revision != waiting.Revision || (stage == 0 && view.Step != nil) || (stage > 0 && (view.Step == nil || view.Step.Position != stage)) {
			t.Fatalf("wrong welcome view: %s", response.Body.String())
		}
		if stage < 2 {
			if strings.Contains(response.Body.String(), "profile_photo") || strings.Contains(response.Body.String(), steps[1].Title) || strings.Contains(response.Body.String(), steps[1].Body) {
				t.Fatal("future action or content leaked")
			}
			assertWelcomeError(t, request(t, a, "GET", "/api/profile", nil, visitor), 423, "welcome_required")
		} else if view.Step.Action == nil || *view.Step.Action != "profile_photo" {
			t.Fatal("current profile action was not returned")
		}
		if strings.Contains(response.Body.String(), steps[2].Title) || strings.Contains(response.Body.String(), steps[2].Body) || strings.Contains(response.Body.String(), `"steps"`) {
			t.Fatal("future instructions leaked")
		}
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(a.config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	reopened.now = a.now
	persisted := readWelcomeState(t, request(t, reopened, "GET", "/api/admin/welcome", nil, host))
	if persisted.Revision != waiting.Revision || persisted.Open || persisted.CurrentStep != 2 || persisted.Steps[1].Action == nil || *persisted.Steps[1].Action != "profile_photo" {
		t.Fatalf("restart lost welcome action or progress: %+v", persisted)
	}
	status(t, request(t, reopened, "GET", "/api/profile", nil, visitor), 200)
	// The host can continue even when this guest has not chosen a photo.
	next := changeWelcome(t, reopened, host, persisted.Revision, "next")
	assertWelcomeError(t, request(t, reopened, "GET", "/api/profile", nil, visitor), 423, "welcome_required")
	changeWelcome(t, reopened, host, next.Revision, "open")
	status(t, request(t, reopened, "GET", "/api/profile", nil, visitor), 200)
}

func TestWelcomeProfileActionAllowsOnlyOwnProfile(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, identity, _ := guest(t, a, host, "Profile step guest")
	other, _, _ := guest(t, a, host, "Other profile guest")
	initial := profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
	otherProfile := profileGuest(t, uploadAvatar(t, a, other, pngBytes(t)))
	mediaResponse := upload(t, a, visitor, pngBytes(t))
	status(t, mediaResponse, 201)
	var photo Photo
	if err := json.Unmarshal(mediaResponse.Body.Bytes(), &photo); err != nil {
		t.Fatal(err)
	}
	steps := []welcomeStep{{Title: "Choose a photo", Action: ptr("profile_photo")}, {Title: "Next instruction"}}
	saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	waiting := changeWelcome(t, a, host, saved.Revision, "start")
	// A future profile action must not unlock its endpoints before it is shown.
	assertWelcomeError(t, uploadAvatar(t, a, visitor, pngBytes(t)), 423, "welcome_required")
	assertWelcomeError(t, request(t, a, "DELETE", "/api/profile/avatar", nil, visitor), 423, "welcome_required")
	assertWelcomeError(t, request(t, a, "GET", *initial.AvatarURL, nil, visitor), 423, "welcome_required")
	shown := changeWelcome(t, a, host, waiting.Revision, "next")
	for _, method := range []string{"GET", "HEAD"} {
		status(t, request(t, a, method, "/api/profile", nil, visitor), 200)
		status(t, request(t, a, method, *initial.AvatarURL, nil, visitor), 200)
		assertWelcomeError(t, request(t, a, method, *otherProfile.AvatarURL, nil, visitor), 423, "welcome_required")
		status(t, request(t, a, method, *initial.AvatarURL, nil, nil), 401)
		status(t, request(t, a, method, *otherProfile.AvatarURL, nil, host), 200)
	}
	for _, header := range []struct{ name, value string }{{"Range", "bytes=0-3"}, {"If-Modified-Since", "Thu, 01 Jan 2099 00:00:00 GMT"}} {
		r := httptest.NewRequest("GET", *otherProfile.AvatarURL, nil)
		r.AddCookie(visitor)
		r.Header.Set(header.name, header.value)
		response := httptest.NewRecorder()
		a.Handler().ServeHTTP(response, r)
		assertWelcomeError(t, response, 423, "welcome_required")
	}
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/party"}, {"HEAD", "/api/party"},
		{"GET", "/api/programme"}, {"HEAD", "/api/programme"},
		{"GET", "/api/guestbook"}, {"HEAD", "/api/guestbook"},
		{"POST", "/api/guestbook"}, {"DELETE", "/api/guestbook/1"},
		{"GET", "/api/photos"}, {"HEAD", "/api/photos"}, {"POST", "/api/photos"},
		{"GET", photo.URL}, {"HEAD", photo.ThumbnailURL}, {"DELETE", "/api/photos/" + strconv.FormatInt(photo.ID, 10)},
		{"GET", "/api/uploads"}, {"HEAD", "/api/uploads"}, {"GET", "/api/uploads/1"},
	} {
		response := request(t, a, route.method, route.path, nil, visitor)
		assertWelcomeError(t, response, 423, "welcome_required")
	}
	changed := profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
	if changed.ID != identity.ID || changed.AvatarURL == nil || *changed.AvatarURL == *initial.AvatarURL {
		t.Fatal("profile action did not replace the guest's avatar")
	}
	if removed := profileGuest(t, request(t, a, "DELETE", "/api/profile/avatar", nil, visitor)); removed.AvatarURL != nil {
		t.Fatal("profile action did not remove the guest's avatar")
	}
	status(t, request(t, a, "GET", *otherProfile.AvatarURL, nil, other), 200)
	current := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
	if current.Revision != shown.Revision || current.CurrentStep != shown.CurrentStep || current.Open {
		t.Fatal("changing a profile photo advanced the shared welcome")
	}
	late, _, _ := guest(t, a, host, "Late profile step guest")
	status(t, request(t, a, "GET", "/api/profile", nil, late), 200)
	status(t, uploadAvatar(t, a, late, pngBytes(t)), 200)
	status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
	status(t, request(t, a, "GET", "/api/profile", nil, visitor), 401)
	status(t, uploadAvatar(t, a, visitor, pngBytes(t)), 401)
	status(t, request(t, a, "DELETE", "/api/profile/avatar", nil, visitor), 401)
	status(t, request(t, a, "HEAD", *initial.AvatarURL, nil, visitor), 401)
	changeWelcome(t, a, host, shown.Revision, "next")
	assertWelcomeError(t, request(t, a, "GET", *otherProfile.AvatarURL, nil, other), 423, "welcome_required")
}

func TestWelcomeProfileActionAdvanceDuringReceptionRejectsLateSave(t *testing.T) {
	for _, ending := range []string{"next", "revoke", "logout"} {
		t.Run(ending, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, identity, _ := guest(t, a, host, "Uploading welcome photo")
			initial := profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
			steps := []welcomeStep{{Title: "Choose a photo", Action: ptr("profile_photo")}, {Title: "The next instruction"}}
			saved := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
			waiting := changeWelcome(t, a, host, saved.Revision, "start")
			shown := changeWelcome(t, a, host, waiting.Revision, "next")
			r := avatarRequest(t, visitor, pngBytes(t))
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch ending {
				case "next":
					changeWelcome(t, a, host, shown.Revision, "next")
				case "revoke":
					status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
				}
			}})
			response := httptest.NewRecorder()
			a.Handler().ServeHTTP(response, r)
			if ending == "next" {
				assertWelcomeError(t, response, 423, "welcome_required")
				assertWelcomeError(t, request(t, a, "DELETE", "/api/profile/avatar", nil, visitor), 423, "welcome_required")
			} else {
				status(t, response, 401)
			}
			status(t, request(t, a, "GET", *initial.AvatarURL, nil, host), 200)
			assertAvatarTempEmpty(t, a)
		})
	}
}

func TestWelcomeActionsMigrationPreservesInstructionsAndProgress(t *testing.T) {
	for _, populated := range []bool{false, true} {
		t.Run(strconv.FormatBool(populated), func(t *testing.T) {
			db := testDatabase(t)
			files := migrationFiles(t)
			delete(files, "migrations/0005_welcome_actions.sql")
			delete(files, "migrations/0006_media_categories.sql")
			if err := applyMigrations(t.Context(), db, files); err != nil {
				t.Fatal(err)
			}
			if populated {
				_, err := db.Exec(`UPDATE welcome SET is_open=false,revision=7,current_step=1,steps='[{"title":"First title","body":"Authored text"},{"title":"Second title","body":"Other text"}]'::jsonb WHERE id=1`)
				if err != nil {
					t.Fatal(err)
				}
			}
			before, err := scanWelcome(db.QueryRow("SELECT is_open,revision,current_step,steps FROM welcome WHERE id=1"))
			if err != nil {
				t.Fatal(err)
			}
			if err := migrate(t.Context(), db); err != nil {
				t.Fatal(err)
			}
			after, err := scanWelcome(db.QueryRow("SELECT is_open,revision,current_step,steps FROM welcome WHERE id=1"))
			if err != nil {
				t.Fatal(err)
			}
			if before.Open != after.Open || before.Revision != after.Revision || before.CurrentStep != after.CurrentStep || len(before.Steps) != len(after.Steps) {
				t.Fatalf("migration changed welcome state: before=%+v after=%+v", before, after)
			}
			for index := range before.Steps {
				if before.Steps[index] != after.Steps[index] {
					t.Fatalf("migration changed instruction %d", index)
				}
			}
			var missing bool
			if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM welcome, jsonb_array_elements(steps) step WHERE NOT step ? 'action' OR step->'action' <> 'null'::jsonb)`).Scan(&missing); err != nil {
				t.Fatal(err)
			}
			if missing {
				t.Fatal("migration did not normalize explicit null actions")
			}
		})
	}
}
