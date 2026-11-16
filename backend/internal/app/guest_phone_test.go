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
