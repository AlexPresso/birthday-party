package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

func voteEvent(t *testing.T, a *App, host *http.Cookie, candidates ...int64) programme.Event {
	t.Helper()
	input := programme.Input{Type: "vote", Title: "Costume vote", Vote: &programme.VoteInput{Question: "Best costume?", CandidateIDs: candidates}}
	response := request(t, a, "POST", "/api/admin/programme", input, host)
	status(t, response, 201)
	return eventResponse(t, response)
}

func eventResponse(t *testing.T, response *httptest.ResponseRecorder) programme.Event {
	t.Helper()
	var result programme.Event
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func voteState(t *testing.T, a *App, host *http.Cookie, event programme.Event, state string) programme.Event {
	t.Helper()
	response := request(t, a, "POST", fmt.Sprintf("/api/admin/programme/%d/vote/state", event.ID), map[string]any{"status": state, "revision": event.Revision}, host)
	status(t, response, 200)
	return eventResponse(t, response)
}

func programmeEvents(t *testing.T, a *App, cookie *http.Cookie, admin bool) []programme.Event {
	t.Helper()
	path := "/api/programme"
	if admin {
		path = "/api/admin/programme"
	}
	response := request(t, a, "GET", path, nil, cookie)
	status(t, response, 200)
	var result struct {
		Items []programme.Event `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Items
}

func TestProgrammeVotesPreservePrivateBallotsAndRevealExplicitly(t *testing.T) {
	a := testApp(t)
	host, hostGuest := admin(t, a)
	first, firstGuest, _ := guest(t, a, host, "First")
	second, secondGuest, _ := guest(t, a, host, "Second")
	third, thirdGuest, _ := guest(t, a, host, "Third")
	profileGuest(t, uploadAvatar(t, a, second, pngBytes(t)))
	event := voteEvent(t, a, host, firstGuest.ID, secondGuest.ID, thirdGuest.ID)
	if len(programmeEvents(t, a, first, false)) != 0 {
		t.Fatal("guest saw draft event")
	}
	if event.Vote.Candidates[1].AvatarURL == nil {
		t.Fatal("candidate portrait missing")
	}
	event = voteState(t, a, host, event, "open")
	path := fmt.Sprintf("/api/programme/%d/vote", event.ID)
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]int64{"candidateId": firstGuest.ID}, first), 400, "self_vote_forbidden")
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]int64{"candidateId": hostGuest.ID}, first), 400, "invalid_vote_candidate")
	for _, candidateID := range []int64{secondGuest.ID, thirdGuest.ID} {
		response := request(t, a, "PUT", path, map[string]int64{"candidateId": candidateID}, first)
		status(t, response, 200)
		vote := eventResponse(t, response)
		if vote.Revision != event.Revision || vote.Vote.MyCandidateID == nil || *vote.Vote.MyCandidateID != candidateID || vote.Vote.ParticipationCount != nil || vote.Vote.Results != nil {
			t.Fatalf("ballot response=%+v", vote)
		}
	}
	status(t, request(t, a, "PUT", path, map[string]int64{"candidateId": secondGuest.ID}, third), 200)
	for _, cookie := range []*http.Cookie{first, second, host} {
		response := request(t, a, "GET", "/api/programme", nil, cookie)
		status(t, response, 200)
		for _, privateField := range []string{`"guestId"`, `"voterId"`, `"ballots"`} {
			if strings.Contains(response.Body.String(), privateField) {
				t.Fatal("response disclosed voter records")
			}
		}
		vote := programmeEvents(t, a, cookie, false)[0].Vote
		if vote.Results != nil || vote.ParticipationCount != nil {
			t.Fatal("unrevealed vote leaked totals")
		}
		if cookie == second && vote.MyCandidateID != nil {
			t.Fatal("another guest received the voter's choice")
		}
	}
	adminVote := programmeEvents(t, a, host, true)[0].Vote
	if adminVote.Results != nil || *adminVote.ParticipationCount != 2 || adminVote.MyCandidateID != nil {
		t.Fatalf("admin view=%+v", adminVote)
	}
	event = voteState(t, a, host, event, "closed")
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]int64{"candidateId": secondGuest.ID}, first), 409, "vote_closed")
	if programmeEvents(t, a, host, true)[0].Vote.Results != nil {
		t.Fatal("closing revealed results")
	}
	event = voteState(t, a, host, event, "revealed")
	if len(event.Vote.Results) != 3 || event.Vote.Results[0].Votes != 0 || event.Vote.Results[1].Votes != 1 || event.Vote.Results[2].Votes != 1 {
		t.Fatalf("wrong revote/tied results: %+v", event.Vote.Results)
	}
	if programmeEvents(t, a, second, false)[0].Vote.ParticipationCount == nil {
		t.Fatal("revealed participation absent")
	}
}

func TestProgrammeVoteRejectsLockedWelcomeAndRevokedCandidates(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Voter")
	other, c, _ := guest(t, a, host, "Candidate")
	event := voteEvent(t, a, host, h.ID, c.ID)
	event = voteState(t, a, host, event, "open")
	path := fmt.Sprintf("/api/programme/%d/vote", event.ID)
	status(t, request(t, a, "PUT", path, map[string]int64{"candidateId": h.ID}, nil), 401)
	status(t, request(t, a, "POST", "/api/admin/programme", nil, visitor), 403)
	future := stamp(a.now().Add(time.Hour))
	status(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Title: "Secret", UnlockAt: &future, Revision: event.Revision}, host), 200)
	if programmeEvents(t, a, visitor, false)[0].Vote != nil {
		t.Fatal("locked event exposed activities")
	}
	status(t, request(t, a, "PUT", path, map[string]int64{"candidateId": h.ID}, visitor), 404)
	status(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Title: "Open", Revision: event.Revision + 1}, host), 200)
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", c.ID), nil, host), 204)
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]int64{"candidateId": c.ID}, visitor), 400, "invalid_vote_candidate")
	status(t, request(t, a, "PUT", path, map[string]int64{"candidateId": h.ID}, other), 401)
	state := changeWelcome(t, a, host, 0, "start")
	assertWelcomeError(t, request(t, a, "PUT", path, map[string]int64{"candidateId": h.ID}, visitor), 423, "welcome_required")
	if _, err := a.programme.Vote(t.Context(), programme.Actor{GuestID: g.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, h.ID); err != access.ErrWelcome {
		t.Fatalf("transaction bypassed welcome access: %v", err)
	}
	if _, err := a.programme.Vote(t.Context(), programme.Actor{GuestID: h.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, c.ID); err != access.ErrExpired {
		t.Fatalf("transaction accepted another guest's session: %v", err)
	}
	changeWelcome(t, a, host, state.Revision, "open")
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", g.ID), nil, host), 204)
	status(t, request(t, a, "PUT", path, map[string]int64{"candidateId": h.ID}, visitor), 401)
}

func TestProgrammeEventEditsPreserveVotesAndDeleteAtomically(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Voter")
	event := voteEvent(t, a, host, h.ID, g.ID)
	event = voteState(t, a, host, event, "open")
	path := fmt.Sprintf("/api/admin/programme/%d", event.ID)
	status(t, request(t, a, "PUT", fmt.Sprintf("/api/programme/%d/vote", event.ID), map[string]int64{"candidateId": h.ID}, visitor), 200)
	input := programme.Input{Type: "vote", Title: "Updated vote", Revision: event.Revision, Vote: &programme.VoteInput{Question: "Corrected question", CandidateIDs: []int64{h.ID, g.ID}}}
	response := request(t, a, "PUT", path, input, host)
	status(t, response, 200)
	event = eventResponse(t, response)
	assertWelcomeError(t, request(t, a, "PUT", path, input, host), 409, "activity_conflict")
	for _, revision := range []int64{0, event.Revision - 1} {
		assertWelcomeError(t, request(t, a, "PUT", path, programme.Input{Title: "Stale title", Revision: revision}, host), 409, "activity_conflict")
	}
	input.Revision = event.Revision
	input.Vote.AllowSelfVote = true
	assertWelcomeError(t, request(t, a, "PUT", path, input, host), 409, "activity_conflict")
	assertWelcomeError(t, request(t, a, "PUT", path, programme.Input{Type: "event", Title: "Changed type", Revision: event.Revision}, host), 409, "activity_conflict")
	metadata := programme.Input{Title: "A new time", Revision: event.Revision}
	response = request(t, a, "PUT", path, metadata, host)
	status(t, response, 200)
	saved := eventResponse(t, response)
	if saved.Type != "vote" || saved.Vote.Question != "Corrected question" || *saved.Vote.ParticipationCount != 1 || saved.Revision != event.Revision+1 {
		t.Fatalf("metadata edit lost vote settings or ballots: %+v", saved)
	}
	status(t, request(t, a, "DELETE", path, nil, host), 204)
	var records int
	if err := a.db.QueryRow("SELECT (SELECT COUNT(*) FROM programme_ballots)+(SELECT COUNT(*) FROM programme_activities)+(SELECT COUNT(*) FROM events)").Scan(&records); err != nil || records != 0 {
		t.Fatalf("deleted vote retained records: %d %v", records, err)
	}
}

func TestProgrammeVoteCreationRollsBackInvalidCandidatesAndSharesEventLimit(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	_, g, _ := guest(t, a, host, "Candidate")
	input := programme.Input{Type: "vote", Title: "Vote", Vote: &programme.VoteInput{Question: "Question", CandidateIDs: []int64{h.ID, 999999}}}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, host), 400, "invalid_vote_candidate")
	var count int
	if err := a.db.QueryRow("SELECT (SELECT COUNT(*) FROM events)+(SELECT COUNT(*) FROM programme_activities)+(SELECT COUNT(*) FROM programme_votes)").Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid candidate left a partial event: %d %v", count, err)
	}
	input.Vote.CandidateIDs = []int64{h.ID, g.ID}
	ordinary := request(t, a, "POST", "/api/admin/programme", programme.Input{Title: "Dinner"}, host)
	status(t, ordinary, 201)
	event := eventResponse(t, ordinary)
	if event.Type != "event" || event.Vote != nil || event.Revision != 1 {
		t.Fatalf("ordinary event contract: %+v", event)
	}
	assertWelcomeError(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), input, host), 409, "activity_conflict")
	if _, err := a.db.Exec("INSERT INTO events(title,description,teaser) SELECT 'Scheduled event','','' FROM generate_series(1,199)"); err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, host), 409, "event_limit_reached")
}

func TestProgrammeConcurrentVotesRemainUniqueAndCloseAtomically(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	first, g, _ := guest(t, a, host, "First")
	second, c, _ := guest(t, a, host, "Second")
	event := voteEvent(t, a, host, h.ID, g.ID, c.ID)
	event = voteState(t, a, host, event, "open")
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 17)
	var work sync.WaitGroup
	for i := range 16 {
		work.Add(1)
		go func() {
			defer work.Done()
			<-start
			cookie, guestID, candidateID := first, g.ID, c.ID
			if i%2 == 1 {
				cookie, guestID, candidateID = second, c.ID, g.ID
			}
			_, err := a.programme.Vote(ctx, programme.Actor{GuestID: guestID, SessionHash: identity.HashToken(cookie.Value)}, event.ID, candidateID)
			results <- err
		}()
	}
	work.Add(1)
	go func() {
		defer work.Done()
		<-start
		_, err := a.programme.Transition(ctx, programme.Actor{GuestID: h.ID, SessionHash: identity.HashToken(host.Value)}, event.ID, "closed", event.Revision)
		results <- err
	}()
	close(start)
	work.Wait()
	close(results)
	for err := range results {
		if err != nil && err != programme.ErrVoteClosed {
			t.Fatalf("concurrent vote/close error: %v", err)
		}
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM programme_ballots WHERE activity_id=(SELECT id FROM programme_activities WHERE event_id=$1)", event.ID).Scan(&count); err != nil || count > 2 {
		t.Fatalf("duplicate ballots=%d error=%v", count, err)
	}
	assertWelcomeError(t, request(t, a, "PUT", fmt.Sprintf("/api/programme/%d/vote", event.ID), map[string]int64{"candidateId": h.ID}, first), 409, "vote_closed")
}

func TestProgrammeVoteRechecksSessionAfterVoteLockWait(t *testing.T) {
	a := testApp(t)
	var clock atomic.Int64
	clock.Store(a.now().Unix())
	a.now = func() time.Time { return time.Unix(clock.Load(), 0) }
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Waiting voter")
	event := voteEvent(t, a, host, h.ID, g.ID)
	event = voteState(t, a, host, event, "open")
	expires := clock.Load() + 1
	if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", time.Unix(expires, 0), identity.HashToken(visitor.Value)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	lock, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	var holder int
	if err := lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM programme_activities WHERE event_id=$1 FOR UPDATE", event.ID).Scan(&holder); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := a.programme.Vote(ctx, programme.Actor{GuestID: g.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, h.ID)
		done <- err
	}()
	for {
		var blocked bool
		if err := a.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))", holder).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("vote never reached event lock")
		case <-time.After(5 * time.Millisecond):
		}
	}
	clock.Store(expires)
	if err := lock.Rollback(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil || err.Error() != "session_expired" {
			t.Fatalf("expired vote error=%v", err)
		}
	case <-ctx.Done():
		t.Fatal("vote did not finish")
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM programme_ballots").Scan(&count); err != nil || count != 0 {
		t.Fatalf("expired ballot committed: %d %v", count, err)
	}
}
