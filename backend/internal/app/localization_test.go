package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestErrorCodesRemainStableAcrossRequestLanguages(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Léa")
	tests := []struct {
		name   string
		method string
		path   string
		body   string
		cookie *http.Cookie
		status int
		code   string
	}{
		{"missing session", "GET", "/api/party", "", nil, 401, "invitation_required"},
		{"host permission", "GET", "/api/admin/guests", "", visitor, 403, "admin_required"},
		{"malformed JSON", "POST", "/api/guestbook", "{", visitor, 400, "invalid_body"},
		{"empty message", "POST", "/api/guestbook", `{"body":" "}`, visitor, 400, "invalid_message"},
		{"invalid invitation", "POST", "/api/invitations/preview", `{"token":"invalid"}`, nil, 401, "invalid_invitation"},
		{"missing photo", "GET", "/api/photos/999/image", "", visitor, 404, "photo_not_found"},
		{"unknown timezone", "PATCH", "/api/admin/party", `{"title":"Party","timezone":"Europe/Unknown"}`, host, 400, "unknown_timezone"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, language := range []string{"fr-CH", "en-US", "de-CH", "it-CH", "es-ES", "ja-JP"} {
				r := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-Requested-With", "birthday-party")
				r.Header.Set("Origin", a.config.PublicURL)
				r.Header.Set("Accept-Language", language)
				if test.cookie != nil {
					r.AddCookie(test.cookie)
				}
				w := httptest.NewRecorder()
				a.Handler().ServeHTTP(w, r)
				status(t, w, test.status)
				var result struct {
					Code  string `json:"code"`
					Error string `json:"error"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Code != test.code || result.Error != errorMessages[test.code] || result.Error == "" {
					t.Fatalf("language %s: expected code %q and English fallback, got %+v", language, test.code, result)
				}
			}
		})
	}
}

func TestUnknownErrorCodeUsesSafeFallback(t *testing.T) {
	w := httptest.NewRecorder()
	fail(w, http.StatusInternalServerError, "private diagnostic")
	status(t, w, http.StatusInternalServerError)
	var result map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["code"] != "internal_error" || result["error"] != "Something went wrong. Try again in a moment." {
		t.Fatalf("unexpected safe fallback: %v", result)
	}
	if strings.Contains(w.Body.String(), "private diagnostic") {
		t.Fatal("unknown error code leaked a diagnostic")
	}
}

func TestLockedEventWithoutTeaserHasNoLanguageSpecificTitle(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Léa")
	input := eventInput{
		Title:       "Secret concert",
		Description: "Private performer and location",
		UnlockAt:    ptr(stamp(a.now().Add(time.Hour))),
	}
	status(t, request(t, a, "POST", "/api/admin/programme", input, host), 201)
	r := request(t, a, "GET", "/api/programme", nil, visitor)
	status(t, r, 200)
	var result struct {
		Items []Event `json:"items"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || !result.Items[0].Locked || result.Items[0].Title != "" || result.Items[0].Description != "" {
		t.Fatalf("expected empty localized presentation fields for the locked event: %s", r.Body.String())
	}
	if strings.Contains(r.Body.String(), input.Title) || strings.Contains(r.Body.String(), input.Description) {
		t.Fatal("locked event exposed private content")
	}
	r = request(t, a, "GET", "/api/admin/programme", nil, host)
	status(t, r, 200)
	if !strings.Contains(r.Body.String(), input.Title) || !strings.Contains(r.Body.String(), input.Description) {
		t.Fatal("host cannot edit the original event content")
	}

	view := eventView(Event{Title: input.Title, Description: input.Description, UnlockAt: ptr("invalid")}, a.now(), false)
	if !view.Locked || view.Title != "" || view.Description != "" {
		t.Fatal("invalid stored unlock date exposed private event content")
	}
}

func TestPartyTitleCanUseLocalizedDefaultWithoutLosingDetails(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	readParty := func(application *App) Party {
		t.Helper()
		response := request(t, application, "GET", "/api/party", nil, host)
		status(t, response, 200)
		var party Party
		if err := json.Unmarshal(response.Body.Bytes(), &party); err != nil {
			t.Fatal(err)
		}
		return party
	}
	if initial := readParty(a); initial.Title != "" {
		t.Fatalf("fresh party must use the localized default title, got %q", initial.Title)
	}

	input := Party{
		Title:    "   ",
		Timezone: "Europe/Rome",
		Date:     ptr("2026-11-14T19:00:00+01:00"),
		Location: "The garden",
	}
	status(t, request(t, a, "PATCH", "/api/admin/party", input, host), 200)
	saved := readParty(a)
	if saved.Title != "" || saved.Timezone != input.Timezone || saved.Location != input.Location || saved.Date == nil || *saved.Date != "2026-11-14T18:00:00Z" {
		t.Fatalf("saving an empty title lost or changed party details: %+v", saved)
	}

	input.Title = "Les 30 ans"
	status(t, request(t, a, "PATCH", "/api/admin/party", input, host), 200)
	if saved := readParty(a); saved.Title != input.Title {
		t.Fatalf("custom party title changed: %q", saved.Title)
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
	if saved := readParty(reopened); saved.Title != input.Title {
		t.Fatalf("reopening changed an existing party title: %q", saved.Title)
	}

	input.Title = ""
	status(t, request(t, reopened, "PATCH", "/api/admin/party", input, host), 200)
	if saved := readParty(reopened); saved.Title != "" || saved.Location != input.Location {
		t.Fatalf("clearing a custom title did not restore the localized default: %+v", saved)
	}
}

func TestOptionalPartyTitleStillEnforcesCharacterLimits(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	input := Party{
		Title:    strings.Repeat("é", 120),
		Timezone: "Europe/Zurich",
		Location: strings.Repeat("é", 240),
	}
	status(t, request(t, a, "PATCH", "/api/admin/party", input, host), 200)
	for _, test := range []struct {
		name     string
		title    string
		location string
	}{
		{"title", strings.Repeat("é", 121), input.Location},
		{"location", "", strings.Repeat("é", 241)},
	} {
		t.Run(test.name, func(t *testing.T) {
			invalid := input
			invalid.Title, invalid.Location = test.title, test.location
			response := request(t, a, "PATCH", "/api/admin/party", invalid, host)
			status(t, response, 400)
			var failure struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
				t.Fatal(err)
			}
			if failure.Code != "invalid_party" {
				t.Fatalf("unexpected party validation code: %q", failure.Code)
			}
			response = request(t, a, "GET", "/api/party", nil, host)
			status(t, response, 200)
			var saved Party
			if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil {
				t.Fatal(err)
			}
			if saved.Title != input.Title || saved.Location != input.Location {
				t.Fatal("invalid update changed the saved party details")
			}
		})
	}
}
