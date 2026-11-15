package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"birthday-party/backend/internal/party"
)

type guestUpdate struct {
	Guest struct {
		Name  string  `json:"name"`
		Phone *string `json:"phone"`
	} `json:"guest"`
	Invitation *struct {
		InvitationURL string `json:"invitationUrl"`
	} `json:"invitation"`
}

func updateGuest(t *testing.T, a *App, host *http.Cookie, path string, input map[string]string) guestUpdate {
	t.Helper()
	response := request(t, a, "PUT", path, input, host)
	status(t, response, 200)
	var result guestUpdate
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestGuestEditsReplaceTheLinkWhenTheNumberChanges(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	_, g, oldToken := guest(t, a, host, "Noé")
	path := fmt.Sprintf("/api/admin/guests/%d", g.ID)

	// The guest used their link; the host notes their number.
	first := updateGuest(t, a, host, path, map[string]string{"name": " Noé Martin ", "phone": "+41 79 123 45 67"})
	if first.Guest.Name != "Noé Martin" || first.Guest.Phone == nil || *first.Guest.Phone != "+41791234567" || first.Invitation == nil {
		t.Fatalf("first update = %+v", first)
	}
	link := first.Invitation.InvitationURL
	// A rename keeps the link; a new number replaces it.
	if renamed := updateGuest(t, a, host, path, map[string]string{"name": "Noé", "phone": "0041791234567"}); renamed.Invitation != nil {
		t.Fatal("an unchanged number issued a new link")
	}
	changed := updateGuest(t, a, host, path, map[string]string{"name": "Noé", "phone": "+33 6 12 34 56 78"})
	if changed.Invitation == nil || changed.Invitation.InvitationURL == link {
		t.Fatalf("changed number = %+v", changed)
	}
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": tokenFromURL(t, link)}, nil), 401)
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": oldToken}, nil), 401)
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": tokenFromURL(t, changed.Invitation.InvitationURL)}, nil), 200)
	// Removing the number is a change too.
	if removed := updateGuest(t, a, host, path, map[string]string{"name": "Noé", "phone": ""}); removed.Invitation == nil || removed.Guest.Phone != nil {
		t.Fatalf("removed number = %+v", removed)
	}

	assertWelcomeError(t, request(t, a, "PUT", path, map[string]string{"name": " ", "phone": ""}, host), 400, "invalid_guest_name")
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]string{"name": "Noé", "phone": "079 123"}, host), 400, "invalid_phone")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/guests/99999", map[string]string{"name": "Nobody", "phone": ""}, host), 404, "not_found")

	// A revoked guest keeps no link: a new number issues none.
	status(t, request(t, a, "DELETE", path, nil, host), 204)
	if revoked := updateGuest(t, a, host, path, map[string]string{"name": "Noé", "phone": "+41 79 000 00 00"}); revoked.Invitation != nil {
		t.Fatal("a revoked guest received a link")
	}
	if countRows(t, a, "SELECT COUNT(*) FROM invitations WHERE guest_id=$1", g.ID) != 0 {
		t.Fatal("a revoked guest kept an invitation")
	}
}

func TestWhatsAppMessageStaysWithTheHost(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	configuration := party.DefaultConfiguration()
	message := "  Coucou {name}, voici ton lien : {link}  "
	configuration.WhatsAppMessage = &message
	saved := request(t, a, "PUT", "/api/admin/config", configuration, host)
	status(t, saved, 200)
	if !strings.Contains(saved.Body.String(), `"whatsappMessage":"Coucou {name}, voici ton lien : {link}"`) {
		t.Fatalf("saved = %s", saved.Body.String())
	}
	public := request(t, a, "GET", "/api/config", nil, nil)
	status(t, public, 200)
	if strings.Contains(public.Body.String(), "whatsapp") || strings.Contains(public.Body.String(), "Coucou") {
		t.Fatalf("public configuration exposed the message: %s", public.Body.String())
	}
	long := strings.Repeat("é", party.MaxWhatsAppMessage+1)
	configuration.WhatsAppMessage = &long
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 400, "invalid_configuration")
	empty := " "
	configuration.WhatsAppMessage = &empty
	cleared := request(t, a, "PUT", "/api/admin/config", configuration, host)
	status(t, cleared, 200)
	if !strings.Contains(cleared.Body.String(), `"whatsappMessage":null`) {
		t.Fatalf("cleared = %s", cleared.Body.String())
	}
	// Omitting the field must not clear it silently.
	body, err := json.Marshal(party.DefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "whatsappMessage")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/config", fields, host), 400, "invalid_body")
}
