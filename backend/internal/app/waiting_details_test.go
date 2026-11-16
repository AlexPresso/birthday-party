package app

import (
	"encoding/json"
	"strings"
	"testing"

	"birthday-party/backend/internal/party"
)

func TestWaitingGuestsReadTheMessageAndWhereThePartyIs(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Waiting guest")
	date := "2027-05-08T16:00:00Z"
	status(t, request(t, a, "PATCH", "/api/admin/party", map[string]any{
		"title": "", "timezone": "Europe/Zurich", "date": date,
		"location": "Salle des fêtes", "mapUrl": "https://maps.app.goo.gl/abc",
	}, host), 200)
	configuration := party.DefaultConfiguration()
	message := "  On t’attend dès 18 h, prends une veste !  "
	configuration.WaitingMessage = &message
	status(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 200)
	changeWelcome(t, a, host, 0, "start")

	// Before the party starts, the guest keeps a session but enters nothing.
	assertWelcomeError(t, request(t, a, "GET", "/api/party", nil, visitor), 425, "party_not_started")
	status(t, request(t, a, "GET", "/api/party", nil, host), 200)
	response := request(t, a, "GET", "/api/welcome/party", nil, visitor)
	status(t, response, 200)
	var details struct {
		Started  bool    `json:"started"`
		Message  *string `json:"message"`
		Date     *string `json:"date"`
		Timezone string  `json:"timezone"`
		Location string  `json:"location"`
		MapURL   string  `json:"mapUrl"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &details); err != nil {
		t.Fatal(err)
	}
	if details.Started || details.Message == nil || *details.Message != strings.TrimSpace(message) || details.Date == nil || *details.Date != date ||
		details.Timezone != "Europe/Zurich" || details.Location != "Salle des fêtes" || details.MapURL != "https://maps.app.goo.gl/abc" {
		t.Fatalf("details = %s", response.Body.String())
	}
	status(t, request(t, a, "GET", "/api/welcome/party", nil, nil), 401)

	// From the party's start, the welcome takes over again.
	status(t, request(t, a, "PATCH", "/api/admin/party", map[string]any{
		"title": "", "timezone": "Europe/Zurich", "date": stamp(a.now()), "location": "Salle des fêtes",
	}, host), 200)
	assertWelcomeError(t, request(t, a, "GET", "/api/party", nil, visitor), 423, "welcome_required")
	if !strings.Contains(request(t, a, "GET", "/api/welcome/party", nil, visitor).Body.String(), `"started":true`) {
		t.Fatal("the party did not start at its date")
	}

	// An emptied message falls back to the interface's line.
	empty := " "
	configuration.WaitingMessage = &empty
	status(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 200)
	response = request(t, a, "GET", "/api/welcome/party", nil, visitor)
	if !strings.Contains(response.Body.String(), `"message":null`) {
		t.Fatalf("details = %s", response.Body.String())
	}
	public := request(t, a, "GET", "/api/config", nil, nil)
	if strings.Contains(public.Body.String(), "waiting") {
		t.Fatalf("public configuration exposed the waiting message: %s", public.Body.String())
	}
}
