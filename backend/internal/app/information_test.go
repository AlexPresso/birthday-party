package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"birthday-party/backend/internal/information"
)

func readInformation[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()
	status(t, response, 200)
	var value T
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestInformationPageIsHostWrittenAndHiddenUntilEnabled(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Information reader")
	empty := information.View{Tabs: []information.Tab{}}

	if view := readInformation[information.View](t, request(t, a, "GET", "/api/information", nil, visitor)); !reflect.DeepEqual(view, empty) {
		t.Fatalf("initial guest view=%+v", view)
	}
	page := readInformation[information.Page](t, request(t, a, "GET", "/api/admin/information", nil, host))
	if page.Enabled || page.Revision != 0 || page.Tabs == nil || len(page.Tabs) != 0 {
		t.Fatalf("initial page=%+v", page)
	}

	// Guests can neither read the host's copy nor write the page.
	assertWelcomeError(t, request(t, a, "GET", "/api/admin/information", nil, visitor), 403, "admin_required")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": 0, "enabled": true, "tabs": []any{}}, visitor), 403, "admin_required")
	status(t, request(t, a, "GET", "/api/information", nil, nil), 401)

	tabs := []information.Tab{
		{Title: "  Useful  ", Body: "  Taxi: +41 79 000 00 00\nhttps://example.org/map  "},
		{Title: "Sleeping", Body: "The chalet has six beds."},
	}
	saved := []information.Tab{
		{Title: "Useful", Body: "Taxi: +41 79 000 00 00\nhttps://example.org/map"},
		{Title: "Sleeping", Body: "The chalet has six beds."},
	}
	// Written but off: the host sees the draft, guests receive nothing.
	page = readInformation[information.Page](t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": 0, "enabled": false, "tabs": tabs}, host))
	if page.Enabled || page.Revision != 1 || !reflect.DeepEqual(page.Tabs, saved) {
		t.Fatalf("saved draft=%+v", page)
	}
	if view := readInformation[information.View](t, request(t, a, "GET", "/api/information", nil, visitor)); !reflect.DeepEqual(view, empty) {
		t.Fatalf("a page that is off leaked its tabs: %+v", view)
	}

	// Turned on but emptied: still nothing to show.
	page = readInformation[information.Page](t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": 1, "enabled": true, "tabs": []any{}}, host))
	if !page.Enabled || page.Revision != 2 {
		t.Fatalf("enabled empty page=%+v", page)
	}
	if view := readInformation[information.View](t, request(t, a, "GET", "/api/information", nil, visitor)); !reflect.DeepEqual(view, empty) {
		t.Fatalf("an empty page was shown: %+v", view)
	}

	page = readInformation[information.Page](t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": 2, "enabled": true, "tabs": tabs}, host))
	for name, reader := range map[string]*http.Cookie{"guest": visitor, "host": host} {
		view := readInformation[information.View](t, request(t, a, "GET", "/api/information", nil, reader))
		if !view.Enabled || !reflect.DeepEqual(view.Tabs, saved) {
			t.Fatalf("%s view=%+v", name, view)
		}
	}

	// A stale editor is told to reload instead of overwriting the page.
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": 2, "enabled": false, "tabs": []any{}}, host), 409, "information_conflict")
	tab := map[string]string{"title": "Title", "body": "Text"}
	for name, body := range map[string]map[string]any{
		"missing revision": {"enabled": true, "tabs": []any{}},
		"missing switch":   {"revision": page.Revision, "tabs": []any{}},
		"missing tabs":     {"revision": page.Revision, "enabled": true},
		"unknown field":    {"revision": page.Revision, "enabled": true, "tabs": []any{map[string]string{"title": "Title", "body": "Text", "html": "<b>"}}},
	} {
		t.Run(name, func(t *testing.T) {
			assertWelcomeError(t, request(t, a, "PUT", "/api/admin/information", body, host), 400, "invalid_body")
		})
	}
	for name, invalid := range map[string][]any{
		"blank title": {map[string]string{"title": " ", "body": "Text"}},
		"blank text":  {map[string]string{"title": "Title", "body": ""}},
		"long title":  {map[string]string{"title": strings.Repeat("é", 41), "body": "Text"}},
		"long text":   {map[string]string{"title": "Title", "body": strings.Repeat("é", 4001)}},
		"too many":    {tab, tab, tab, tab, tab, tab, tab, tab, tab},
	} {
		t.Run(name, func(t *testing.T) {
			assertWelcomeError(t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": page.Revision, "enabled": true, "tabs": invalid}, host), 400, "invalid_information")
		})
	}
	if unchanged := readInformation[information.Page](t, request(t, a, "GET", "/api/admin/information", nil, host)); unchanged.Revision != page.Revision || !reflect.DeepEqual(unchanged.Tabs, saved) {
		t.Fatalf("a rejected save changed the page: %+v", unchanged)
	}

	// The largest allowed page fits in one request.
	full := make([]information.Tab, 8)
	for i := range full {
		full[i] = information.Tab{Title: strings.Repeat("é", 40), Body: strings.Repeat("é", 4000)}
	}
	page = readInformation[information.Page](t, request(t, a, "PUT", "/api/admin/information", map[string]any{"revision": page.Revision, "enabled": true, "tabs": full}, host))
	if len(page.Tabs) != 8 {
		t.Fatalf("largest page was not saved: %d tabs", len(page.Tabs))
	}

	// The page belongs to the app: it stays closed during the welcome sequence.
	state := readWelcomeState(t, request(t, a, "GET", "/api/admin/welcome", nil, host))
	changeWelcome(t, a, host, state.Revision, "start")
	assertWelcomeError(t, request(t, a, "GET", "/api/information", nil, visitor), 423, "welcome_required")
	if view := readInformation[information.View](t, request(t, a, "GET", "/api/information", nil, host)); !view.Enabled {
		t.Fatalf("the host lost the page during the welcome: %+v", view)
	}
}
