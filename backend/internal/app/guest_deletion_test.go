package app

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestPermanentGuestDeletionKeepsContentWithoutAuthor(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Departing")
	voter, _, _ := guest(t, a, host, "Voter")
	record := fmt.Sprintf("/api/admin/guests/%d/record", g.ID)

	status(t, request(t, a, "POST", "/api/guestbook", map[string]any{"body": "Signed message", "anonymous": false}, visitor), 201)
	event := voteState(t, a, host, voteEvent(t, a, host, h.ID, g.ID), "open")
	status(t, castVote(t, a, visitor, event.ID, optionOfGuest(t, event.Vote, h.ID).ID), 200)
	status(t, castVote(t, a, voter, event.ID, optionOfGuest(t, event.Vote, g.ID).ID), 200)
	if _, err := a.db.Exec(`INSERT INTO photos(guest_id,filename,thumbnail,mime,width,height,byte_size,created_at)
 VALUES($1,'kept.jpg','kept-thumb.jpg','image/jpeg',10,10,100,$2)`, g.ID, a.now()); err != nil {
		t.Fatal(err)
	}

	assertWelcomeError(t, request(t, a, "DELETE", record, nil, host), 409, "guest_active")
	assertWelcomeError(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d/record", h.ID), nil, host), 409, "self_revoke_forbidden")
	status(t, request(t, a, "DELETE", record, nil, visitor), 403)
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", g.ID), nil, host), 204)

	// A job still in preparation needs its guest until it settles.
	if _, err := a.db.Exec(`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,available_at,created_at,updated_at)
 VALUES($1,'pending','queued','clip.mp4','video','mp4','pending-key',1,$2,$2,$2)`, g.ID, a.now()); err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, request(t, a, "DELETE", record, nil, host), 409, "guest_uploads_pending")
	if _, err := a.db.Exec("UPDATE upload_jobs SET status='failed' WHERE guest_id=$1", g.ID); err != nil {
		t.Fatal(err)
	}

	status(t, request(t, a, "DELETE", record, nil, host), 204)
	assertWelcomeError(t, request(t, a, "DELETE", record, nil, host), 404, "not_found")

	if count := countRows(t, a, "SELECT COUNT(*) FROM guests WHERE id=$1", g.ID); count != 0 {
		t.Fatal("the guest survived permanent deletion")
	}
	var book struct {
		Items []struct {
			Author    *json.RawMessage `json:"author"`
			Anonymous bool             `json:"anonymous"`
			CanDelete bool             `json:"canDelete"`
			Body      string           `json:"body"`
		} `json:"items"`
	}
	response := request(t, a, "GET", "/api/guestbook", nil, host)
	status(t, response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	if len(book.Items) != 1 || book.Items[0].Author != nil || !book.Items[0].Anonymous || !book.Items[0].CanDelete || book.Items[0].Body != "Signed message" {
		t.Fatalf("guestbook after deletion=%+v", book.Items)
	}
	var gallery struct {
		Items []struct {
			Author *json.RawMessage `json:"author"`
		} `json:"items"`
	}
	response = request(t, a, "GET", "/api/photos", nil, host)
	status(t, response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &gallery); err != nil {
		t.Fatal(err)
	}
	if len(gallery.Items) != 1 || gallery.Items[0].Author != nil {
		t.Fatalf("gallery after deletion=%s", response.Body.String())
	}
	// The guest's own ballot and their option, with its ballots, are gone.
	vote := voteOf(t, a, voter, false, event.ID)
	if len(vote.Options) != 1 || vote.Options[0].Votes != 0 || countRows(t, a, "SELECT COUNT(*) FROM programme_ballots") != 0 {
		t.Fatalf("vote after deletion: %s", tally(vote))
	}
	if countRows(t, a, "SELECT COUNT(*) FROM upload_jobs") != 0 {
		t.Fatal("the guest's upload history survived")
	}
}
