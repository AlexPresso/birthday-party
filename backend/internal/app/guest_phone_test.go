package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestGuestPhonesStayWithTheHost(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/guests", map[string]string{"name": "Local", "phone": "079 123 45 67"}, host), 400, "invalid_phone")
	created := request(t, a, "POST", "/api/admin/guests", map[string]string{"name": "Noé", "phone": "+41 79 123 45 67"}, host)
	status(t, created, 201)
	var result struct {
		Guest struct {
			ID    int64   `json:"id"`
			Phone *string `json:"phone"`
		} `json:"guest"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Guest.Phone == nil || *result.Guest.Phone != "+41791234567" {
		t.Fatalf("created guest = %s", created.Body.String())
	}
	visitor, _, _ := guest(t, a, host, "Other")
	path := fmt.Sprintf("/api/admin/guests/%d", result.Guest.ID)
	status(t, request(t, a, "PUT", path, map[string]string{"name": "Noé", "phone": "+33 6 12 34 56 78"}, visitor), 403)
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]string{"name": "Noé", "phone": "+41 79 abc"}, host), 400, "invalid_phone")
	status(t, request(t, a, "PUT", path, map[string]string{"name": "Noé", "phone": "0033 6 12 34 56 78"}, host), 200)

	listed := request(t, a, "GET", "/api/admin/guests", nil, host)
	status(t, listed, 200)
	if !strings.Contains(listed.Body.String(), `"phone":"+33612345678"`) {
		t.Fatalf("guest list = %s", listed.Body.String())
	}
	// Guests never receive a number, theirs or another's.
	for _, path := range []string{"/api/session", "/api/guestbook"} {
		response := request(t, a, "GET", path, nil, visitor)
		status(t, response, 200)
		if strings.Contains(response.Body.String(), "phone") {
			t.Fatalf("%s exposed a phone number: %s", path, response.Body.String())
		}
	}
	status(t, request(t, a, "PUT", path, map[string]string{"name": "Noé", "phone": ""}, host), 200)
	if countRows(t, a, "SELECT COUNT(*) FROM guests WHERE phone IS NOT NULL") != 0 {
		t.Fatal("an empty number did not remove the phone")
	}
}

func TestGuestListTellsWhoJoined(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	_, entered, _ := guest(t, a, host, "Entered")
	status(t, request(t, a, "POST", "/api/admin/guests", map[string]string{"name": "Not yet"}, host), 201)
	// A new link for someone who already came in does not make them new again.
	status(t, request(t, a, "POST", fmt.Sprintf("/api/admin/guests/%d/invitation", entered.ID), map[string]string{}, host), 200)
	listed := request(t, a, "GET", "/api/admin/guests", nil, host)
	status(t, listed, 200)
	var result struct {
		Items []struct {
			Name   string `json:"name"`
			Joined *bool  `json:"joined"`
		} `json:"items"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	joined := map[string]bool{}
	for _, item := range result.Items {
		if item.Joined == nil {
			t.Fatalf("%s has no joined state", item.Name)
		}
		joined[item.Name] = *item.Joined
	}
	if !joined["Camille"] || !joined["Entered"] || joined["Not yet"] {
		t.Fatalf("joined = %v", joined)
	}
	session := request(t, a, "GET", "/api/session", nil, host)
	if strings.Contains(session.Body.String(), "joined") {
		t.Fatalf("the session exposed the joined state: %s", session.Body.String())
	}
}

func TestPartyMapLinkIsSavedForGuests(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Visitor")
	details := map[string]any{"title": "", "timezone": "Europe/Zurich", "date": nil, "location": "Salle des fêtes", "mapUrl": "http://maps.example"}
	assertWelcomeError(t, request(t, a, "PATCH", "/api/admin/party", details, host), 400, "invalid_map_link")
	details["mapUrl"] = " https://maps.app.goo.gl/abc "
	status(t, request(t, a, "PATCH", "/api/admin/party", details, host), 200)
	read := request(t, a, "GET", "/api/party", nil, visitor)
	status(t, read, 200)
	if !strings.Contains(read.Body.String(), `"mapUrl":"https://maps.app.goo.gl/abc"`) {
		t.Fatalf("party = %s", read.Body.String())
	}
}
