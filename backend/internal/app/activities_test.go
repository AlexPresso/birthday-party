package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

func createVote(t *testing.T, a *App, host *http.Cookie, vote programme.VoteInput) programme.Event {
	t.Helper()
	vote.Question = "Best costume?"
	response := request(t, a, "POST", "/api/admin/programme", programme.Input{Type: programme.TypeVote, Title: "Costume vote", Vote: &vote}, host)
	status(t, response, 201)
	return eventResponse(t, response)
}

func voteEvent(t *testing.T, a *App, host *http.Cookie, candidates ...int64) programme.Event {
	t.Helper()
	return createVote(t, a, host, programme.VoteInput{Choices: programme.ChoicesGuests, CandidateIDs: candidates})
}

func customVote(t *testing.T, a *App, host *http.Cookie, allowWriteIns bool, labels ...string) programme.Event {
	t.Helper()
	return createVote(t, a, host, programme.VoteInput{Choices: programme.ChoicesCustom, Labels: labels, AllowWriteIns: allowWriteIns})
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

// voteOf returns the vote of one event as the viewer's programme shows it.
func voteOf(t *testing.T, a *App, cookie *http.Cookie, admin bool, eventID int64) *programme.Vote {
	t.Helper()
	for _, event := range programmeEvents(t, a, cookie, admin) {
		if event.ID == eventID {
			if event.Vote == nil {
				t.Fatalf("event %d shows no vote", eventID)
			}
			return event.Vote
		}
	}
	t.Fatalf("event %d is not in the programme", eventID)
	return nil
}

func castVote(t *testing.T, a *App, cookie *http.Cookie, eventID, optionID int64) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, a, "PUT", fmt.Sprintf("/api/programme/%d/vote", eventID), map[string]int64{"optionId": optionID}, cookie)
}

func writeIn(t *testing.T, a *App, cookie *http.Cookie, eventID int64, label string) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, a, "POST", fmt.Sprintf("/api/programme/%d/vote/options", eventID), map[string]string{"label": label}, cookie)
}

func removeOption(t *testing.T, a *App, cookie *http.Cookie, eventID, optionID int64) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, a, "DELETE", fmt.Sprintf("/api/admin/programme/%d/vote/options/%d", eventID, optionID), nil, cookie)
}

func optionLabeled(t *testing.T, vote *programme.Vote, label string) programme.VoteOption {
	t.Helper()
	for _, option := range vote.Options {
		if option.Label == label {
			return option
		}
	}
	t.Fatalf("no option labeled %q in %s", label, tally(vote))
	return programme.VoteOption{}
}

func optionOfGuest(t *testing.T, vote *programme.Vote, guestID int64) programme.VoteOption {
	t.Helper()
	for _, option := range vote.Options {
		if option.GuestID != nil && *option.GuestID == guestID {
			return option
		}
	}
	t.Fatalf("no option for guest %d in %s", guestID, tally(vote))
	return programme.VoteOption{}
}

// tally renders the options in response order with their counts.
func tally(vote *programme.Vote) string {
	parts := make([]string, len(vote.Options))
	for i, option := range vote.Options {
		parts[i] = fmt.Sprintf("%s=%d", option.Label, option.Votes)
	}
	return strings.Join(parts, " ")
}

func assertTally(t *testing.T, vote *programme.Vote, want string) {
	t.Helper()
	if got := tally(vote); got != want {
		t.Fatalf("options=%q want %q", got, want)
	}
}

func chose(vote *programme.Vote, optionID int64) bool {
	return vote.MyOptionID != nil && *vote.MyOptionID == optionID
}

func countRows(t *testing.T, a *App, query string, args ...any) int {
	t.Helper()
	var count int
	if err := a.db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestGuestVotesShowLiveCountsAndKeepVotersPrivate(t *testing.T) {
	a := testApp(t)
	host, hostGuest := admin(t, a)
	first, firstGuest, _ := guest(t, a, host, "First")
	second, secondGuest, _ := guest(t, a, host, "Second")
	third, thirdGuest, _ := guest(t, a, host, "Third")
	profileGuest(t, uploadAvatar(t, a, second, pngBytes(t)))
	event := voteEvent(t, a, host, firstGuest.ID, secondGuest.ID, thirdGuest.ID)
	foreign := optionOfGuest(t, voteEvent(t, a, host, hostGuest.ID, firstGuest.ID).Vote, hostGuest.ID)
	if len(programmeEvents(t, a, first, false)) != 0 {
		t.Fatal("guest saw draft event")
	}
	portrait := optionOfGuest(t, event.Vote, secondGuest.ID)
	if portrait.Label != "Second" || portrait.AvatarURL == nil || !portrait.Active || portrait.WriteIn {
		t.Fatalf("guest option=%+v", portrait)
	}
	if event.Vote.Choices != programme.ChoicesGuests || event.Vote.CanVote || optionOfGuest(t, event.Vote, firstGuest.ID).AvatarURL != nil {
		t.Fatalf("draft vote=%+v", event.Vote)
	}
	status(t, castVote(t, a, first, event.ID, portrait.ID), 404)
	event = voteState(t, a, host, event, "open")
	own, secondOption, thirdOption := optionOfGuest(t, event.Vote, firstGuest.ID), optionOfGuest(t, event.Vote, secondGuest.ID), optionOfGuest(t, event.Vote, thirdGuest.ID)
	assertWelcomeError(t, castVote(t, a, first, event.ID, own.ID), 400, "self_vote_forbidden")
	for _, unavailable := range []int64{foreign.ID, 999999, 0} {
		assertWelcomeError(t, castVote(t, a, first, event.ID, unavailable), 400, "invalid_vote_option")
	}
	for _, option := range []programme.VoteOption{secondOption, thirdOption} {
		response := castVote(t, a, first, event.ID, option.ID)
		status(t, response, 200)
		voted := eventResponse(t, response)
		if voted.Revision != event.Revision || !chose(voted.Vote, option.ID) || optionLabeled(t, voted.Vote, option.Label).Votes != 1 {
			t.Fatalf("ballot response=%+v", voted.Vote)
		}
	}
	status(t, castVote(t, a, third, event.ID, secondOption.ID), 200)
	const live = "Second=1 Third=1 First=0"
	for _, viewer := range []struct {
		cookie *http.Cookie
		admin  bool
		choice *int64
	}{{first, false, &thirdOption.ID}, {second, false, nil}, {host, false, nil}, {host, true, nil}} {
		path := "/api/programme"
		if viewer.admin {
			path = "/api/admin/programme"
		}
		body := request(t, a, "GET", path, nil, viewer.cookie).Body.String()
		for _, removed := range []string{`"voterId"`, `"ballots"`, `"candidates"`, `"myCandidateId"`, `"participationCount"`, `"results"`} {
			if strings.Contains(body, removed) {
				t.Fatalf("response contains %s: %s", removed, body)
			}
		}
		vote := voteOf(t, a, viewer.cookie, viewer.admin, event.ID)
		assertTally(t, vote, live)
		if !vote.CanVote || (viewer.choice == nil) != (vote.MyOptionID == nil) || viewer.choice != nil && !chose(vote, *viewer.choice) {
			t.Fatalf("viewer %+v received choice %v, canVote=%t", viewer, vote.MyOptionID, vote.CanVote)
		}
	}
	event = voteState(t, a, host, event, "closed")
	assertWelcomeError(t, castVote(t, a, first, event.ID, secondOption.ID), 409, "vote_closed")
	closed := voteOf(t, a, second, false, event.ID)
	assertTally(t, closed, live)
	if closed.Status != programme.VoteClosed || closed.CanVote {
		t.Fatalf("closed vote=%+v", closed)
	}
	for _, state := range []string{"revealed", "open", "draft"} {
		transition := request(t, a, "POST", fmt.Sprintf("/api/admin/programme/%d/vote/state", event.ID), map[string]any{"status": state, "revision": event.Revision}, host)
		assertWelcomeError(t, transition, 409, "activity_conflict")
	}
}

func TestProgrammeVoteRejectsLockedWelcomeAndRevokedCandidates(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Voter")
	other, c, _ := guest(t, a, host, "Candidate")
	event := voteEvent(t, a, host, h.ID, c.ID)
	event = voteState(t, a, host, event, "open")
	hostOption, candidateOption := optionOfGuest(t, event.Vote, h.ID), optionOfGuest(t, event.Vote, c.ID)
	status(t, castVote(t, a, nil, event.ID, hostOption.ID), 401)
	status(t, request(t, a, "POST", "/api/admin/programme", nil, visitor), 403)
	status(t, castVote(t, a, visitor, event.ID, candidateOption.ID), 200)
	future := stamp(a.now().Add(time.Hour))
	status(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Title: "Secret", UnlockAt: &future, Revision: event.Revision}, host), 200)
	if programmeEvents(t, a, visitor, false)[0].Vote != nil {
		t.Fatal("locked event exposed activities")
	}
	status(t, castVote(t, a, visitor, event.ID, hostOption.ID), 404)
	status(t, writeIn(t, a, visitor, event.ID, "Someone else"), 404)
	status(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Title: "Open", Revision: event.Revision + 1}, host), 200)
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", c.ID), nil, host), 204)
	assertWelcomeError(t, castVote(t, a, visitor, event.ID, candidateOption.ID), 400, "invalid_vote_option")
	revoked := optionOfGuest(t, voteOf(t, a, visitor, false, event.ID), c.ID)
	if revoked.ID != candidateOption.ID || revoked.Active || revoked.Votes != 1 || revoked.Label != "Candidate" {
		t.Fatalf("revoked guest option=%+v", revoked)
	}
	status(t, castVote(t, a, other, event.ID, hostOption.ID), 401)
	state := changeWelcome(t, a, host, 0, "start")
	assertWelcomeError(t, castVote(t, a, visitor, event.ID, hostOption.ID), 423, "welcome_required")
	assertWelcomeError(t, writeIn(t, a, visitor, event.ID, "Someone else"), 423, "welcome_required")
	if _, err := a.programme.Vote(t.Context(), programme.Actor{GuestID: g.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, hostOption.ID); err != access.ErrWelcome {
		t.Fatalf("transaction bypassed welcome access: %v", err)
	}
	if _, err := a.programme.Vote(t.Context(), programme.Actor{GuestID: h.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, candidateOption.ID); err != access.ErrExpired {
		t.Fatalf("transaction accepted another guest's session: %v", err)
	}
	changeWelcome(t, a, host, state.Revision, "open")
	status(t, castVote(t, a, visitor, event.ID, hostOption.ID), 200)
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", g.ID), nil, host), 204)
	status(t, castVote(t, a, visitor, event.ID, hostOption.ID), 401)
}

func TestProgrammeEventEditsPreserveVotesAndDeleteAtomically(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Voter")
	event := voteEvent(t, a, host, h.ID, g.ID)
	event = voteState(t, a, host, event, "open")
	hostOption := optionOfGuest(t, event.Vote, h.ID)
	path := fmt.Sprintf("/api/admin/programme/%d", event.ID)
	status(t, castVote(t, a, visitor, event.ID, hostOption.ID), 200)
	input := programme.Input{Type: programme.TypeVote, Title: "Updated vote", Revision: event.Revision, Vote: &programme.VoteInput{
		Question: "Corrected question", Choices: programme.ChoicesGuests, CandidateIDs: []int64{g.ID, h.ID},
	}}
	response := request(t, a, "PUT", path, input, host)
	status(t, response, 200)
	event = eventResponse(t, response)
	assertWelcomeError(t, request(t, a, "PUT", path, input, host), 409, "activity_conflict")
	for _, revision := range []int64{0, event.Revision - 1} {
		assertWelcomeError(t, request(t, a, "PUT", path, programme.Input{Title: "Stale title", Revision: revision}, host), 409, "activity_conflict")
	}
	input.Revision = event.Revision
	for name, frozen := range map[string]programme.VoteInput{
		"self-vote":  {Question: "Q", Choices: programme.ChoicesGuests, CandidateIDs: []int64{h.ID, g.ID}, AllowSelfVote: true},
		"candidates": {Question: "Q", Choices: programme.ChoicesGuests, CandidateIDs: []int64{h.ID, g.ID, 999999}},
		"source":     {Question: "Q", Choices: programme.ChoicesCustom, Labels: []string{"A", "B"}},
	} {
		t.Run("frozen "+name, func(t *testing.T) {
			input.Vote = &frozen
			assertWelcomeError(t, request(t, a, "PUT", path, input, host), 409, "activity_conflict")
		})
	}
	assertWelcomeError(t, request(t, a, "PUT", path, programme.Input{Type: programme.TypeEvent, Title: "Changed type", Revision: event.Revision}, host), 409, "activity_conflict")
	metadata := programme.Input{Title: "A new time", Revision: event.Revision}
	response = request(t, a, "PUT", path, metadata, host)
	status(t, response, 200)
	saved := eventResponse(t, response)
	kept := optionOfGuest(t, saved.Vote, h.ID)
	if saved.Type != programme.TypeVote || saved.Vote.Question != "Corrected question" || kept.ID != hostOption.ID || kept.Votes != 1 || saved.Revision != event.Revision+1 {
		t.Fatalf("metadata edit lost vote settings, option identity or ballots: %+v", saved.Vote)
	}
	status(t, request(t, a, "DELETE", path, nil, host), 204)
	records := countRows(t, a, `SELECT (SELECT COUNT(*) FROM programme_ballots)+(SELECT COUNT(*) FROM programme_vote_options)
 +(SELECT COUNT(*) FROM programme_activities)+(SELECT COUNT(*) FROM events)`)
	if records != 0 {
		t.Fatalf("deleted vote retained %d records", records)
	}
}

func TestProgrammeVoteCreationRollsBackInvalidCandidatesAndSharesEventLimit(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	_, g, _ := guest(t, a, host, "Candidate")
	input := programme.Input{Type: programme.TypeVote, Title: "Vote", Vote: &programme.VoteInput{Question: "Question", Choices: programme.ChoicesGuests, CandidateIDs: []int64{h.ID, 999999}}}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, host), 400, "invalid_vote_option")
	partial := countRows(t, a, `SELECT (SELECT COUNT(*) FROM events)+(SELECT COUNT(*) FROM programme_activities)
 +(SELECT COUNT(*) FROM programme_votes)+(SELECT COUNT(*) FROM programme_vote_options)`)
	if partial != 0 {
		t.Fatalf("invalid candidate left %d records of a partial event", partial)
	}
	input.Vote.CandidateIDs = []int64{h.ID, g.ID}
	ordinary := request(t, a, "POST", "/api/admin/programme", programme.Input{Title: "Dinner"}, host)
	status(t, ordinary, 201)
	event := eventResponse(t, ordinary)
	if event.Type != programme.TypeEvent || event.Vote != nil || event.Revision != 1 {
		t.Fatalf("ordinary event contract: %+v", event)
	}
	assertWelcomeError(t, request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), input, host), 409, "activity_conflict")
	if _, err := a.db.Exec("INSERT INTO events(title,description,teaser) SELECT 'Scheduled event','','' FROM generate_series(1,199)"); err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, host), 409, "event_limit_reached")
}

func TestVoteSettingsAreValidatedAndReplaceableWhileDraft(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	_, g, _ := guest(t, a, host, "Candidate")
	for _, test := range []struct {
		name string
		vote programme.VoteInput
		code string
	}{
		{"missing source", programme.VoteInput{CandidateIDs: []int64{h.ID, g.ID}}, "invalid_activity"},
		{"guests with write-ins", programme.VoteInput{Choices: programme.ChoicesGuests, CandidateIDs: []int64{h.ID, g.ID}, AllowWriteIns: true}, "invalid_activity"},
		{"guests with labels", programme.VoteInput{Choices: programme.ChoicesGuests, CandidateIDs: []int64{h.ID, g.ID}, Labels: []string{"A"}}, "invalid_activity"},
		{"labels with self-vote", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"A", "B"}, AllowSelfVote: true}, "invalid_activity"},
		{"labels with candidates", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"A", "B"}, CandidateIDs: []int64{h.ID}}, "invalid_activity"},
		{"one label without write-ins", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"A"}}, "invalid_activity"},
		{"labels differing by case", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"Tarte", " tarte "}}, "invalid_activity"},
		{"too many labels", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: numberedLabels(programme.OptionLimit + 1)}, "invalid_activity"},
		{"blank label", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"A", " "}}, "invalid_vote_label"},
		{"long label", programme.VoteInput{Choices: programme.ChoicesCustom, Labels: []string{"A", strings.Repeat("é", 81)}}, "invalid_vote_label"},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.vote.Question = "Question"
			input := programme.Input{Type: programme.TypeVote, Title: "Vote", Vote: &test.vote}
			assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, host), 400, test.code)
		})
	}
	if count := countRows(t, a, "SELECT COUNT(*) FROM events"); count != 0 {
		t.Fatalf("invalid settings created %d events", count)
	}
	event := voteEvent(t, a, host, h.ID, g.ID)
	path := fmt.Sprintf("/api/admin/programme/%d", event.ID)
	labels := programme.Input{Title: "Vote", Revision: event.Revision, Vote: &programme.VoteInput{
		Question: "Dessert?", Choices: programme.ChoicesCustom, Labels: []string{strings.Repeat("é", 80), " Mousse "}, AllowWriteIns: true,
	}}
	response := request(t, a, "PUT", path, labels, host)
	status(t, response, 200)
	event = eventResponse(t, response)
	if event.Vote.Choices != programme.ChoicesCustom || !event.Vote.AllowWriteIns || event.Vote.AllowSelfVote || len(event.Vote.Options) != 2 {
		t.Fatalf("draft settings=%+v", event.Vote)
	}
	if longest := optionLabeled(t, event.Vote, strings.Repeat("é", 80)); longest.WriteIn || optionLabeled(t, event.Vote, "Mousse").WriteIn {
		t.Fatalf("host labels saved as write-ins: %+v", event.Vote.Options)
	}
	guests := programme.Input{Title: "Vote", Revision: event.Revision, Vote: &programme.VoteInput{
		Question: "Costume?", Choices: programme.ChoicesGuests, CandidateIDs: []int64{g.ID, h.ID}, AllowSelfVote: true,
	}}
	response = request(t, a, "PUT", path, guests, host)
	status(t, response, 200)
	event = eventResponse(t, response)
	if event.Vote.Choices != programme.ChoicesGuests || event.Vote.AllowWriteIns || !event.Vote.AllowSelfVote || len(event.Vote.Options) != 2 {
		t.Fatalf("draft settings=%+v", event.Vote)
	}
	if stale := countRows(t, a, "SELECT COUNT(*) FROM programme_vote_options WHERE label IS NOT NULL"); stale != 0 {
		t.Fatalf("replaced draft kept %d label options", stale)
	}
}

func numberedLabels(count int) []string {
	labels := make([]string, count)
	for i := range labels {
		labels[i] = fmt.Sprintf("Choice %03d", i)
	}
	return labels
}

func TestCustomVoteOrdersOptionsByVotesThenLabelForEveryViewer(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First")
	second, _, _ := guest(t, a, host, "Second")
	third, _, _ := guest(t, a, host, "Third")
	created := request(t, a, "POST", "/api/admin/programme", programme.Input{Type: programme.TypeVote, Title: "Dessert", Vote: &programme.VoteInput{
		Question: "Which dessert?", Choices: programme.ChoicesCustom, Labels: []string{"banana", "  Cherry ", "apple"},
	}}, host)
	status(t, created, 201)
	var contract struct {
		Vote map[string]json.RawMessage `json:"vote"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &contract); err != nil {
		t.Fatal(err)
	}
	fields := make([]string, 0, len(contract.Vote))
	for field := range contract.Vote {
		fields = append(fields, field)
	}
	slices.Sort(fields)
	if got := strings.Join(fields, ","); got != "allowSelfVote,allowWriteIns,canVote,choices,myOptionId,options,question,status" {
		t.Fatalf("vote fields=%s", got)
	}
	event := eventResponse(t, created)
	assertTally(t, event.Vote, "apple=0 banana=0 Cherry=0")
	apple := optionLabeled(t, event.Vote, "apple")
	wantOption := fmt.Sprintf(`{"id":%d,"label":"apple","guestId":null,"avatarUrl":null,"active":true,"writeIn":false,"votes":0}`, apple.ID)
	if !strings.Contains(created.Body.String(), wantOption) || !strings.Contains(created.Body.String(), `"myOptionId":null`) {
		t.Fatalf("option contract: %s", created.Body.String())
	}
	event = voteState(t, a, host, event, "open")
	banana, cherry := optionLabeled(t, event.Vote, "banana"), optionLabeled(t, event.Vote, "Cherry")
	if optionLabeled(t, event.Vote, "apple").ID != apple.ID {
		t.Fatal("opening changed option IDs")
	}
	assertWelcomeError(t, writeIn(t, a, first, event.ID, "Durian"), 403, "write_ins_disabled")
	assertWelcomeError(t, writeIn(t, a, first, event.ID, "cherry"), 403, "write_ins_disabled")
	status(t, castVote(t, a, first, event.ID, banana.ID), 200)
	assertTally(t, voteOf(t, a, second, false, event.ID), "banana=1 apple=0 Cherry=0")
	status(t, castVote(t, a, second, event.ID, cherry.ID), 200)
	assertTally(t, voteOf(t, a, third, false, event.ID), "banana=1 Cherry=1 apple=0")
	status(t, castVote(t, a, third, event.ID, cherry.ID), 200)
	for _, viewer := range []struct {
		cookie *http.Cookie
		admin  bool
		choice *int64
	}{{first, false, &banana.ID}, {third, false, &cherry.ID}, {host, false, nil}, {host, true, nil}} {
		vote := voteOf(t, a, viewer.cookie, viewer.admin, event.ID)
		assertTally(t, vote, "Cherry=2 banana=1 apple=0")
		if !vote.CanVote || (viewer.choice == nil) != (vote.MyOptionID == nil) || viewer.choice != nil && !chose(vote, *viewer.choice) {
			t.Fatalf("viewer received choice %v, canVote=%t", vote.MyOptionID, vote.CanVote)
		}
	}
	voteState(t, a, host, event, "closed")
	closed := voteOf(t, a, first, false, event.ID)
	assertTally(t, closed, "Cherry=2 banana=1 apple=0")
	if closed.CanVote || !chose(closed, banana.ID) {
		t.Fatalf("closed vote=%+v", closed)
	}
}

func TestWriteInsFindOrCreateOptionsWhateverTheCase(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, firstGuest, _ := guest(t, a, host, "First")
	second, secondGuest, _ := guest(t, a, host, "Second")
	event := customVote(t, a, host, true)
	if len(event.Vote.Options) != 0 || event.Vote.CanVote {
		t.Fatalf("empty draft=%+v", event.Vote)
	}
	status(t, writeIn(t, a, first, event.ID, "Too early"), 404)
	event = voteState(t, a, host, event, "open")
	if !voteOf(t, a, first, false, event.ID).CanVote {
		t.Fatal("open write-in vote without options cannot be voted")
	}
	for _, label := range []string{"", " \t", strings.Repeat("é", 81)} {
		assertWelcomeError(t, writeIn(t, a, first, event.ID, label), 400, "invalid_vote_label")
	}
	response := writeIn(t, a, first, event.ID, "  Tarte Tatin ")
	status(t, response, 200)
	created := eventResponse(t, response)
	tarte := optionLabeled(t, created.Vote, "Tarte Tatin")
	if !tarte.WriteIn || !tarte.Active || tarte.GuestID != nil || tarte.Votes != 1 || !chose(created.Vote, tarte.ID) || created.Revision != event.Revision {
		t.Fatalf("write-in response=%+v", created.Vote)
	}
	response = writeIn(t, a, second, event.ID, "tarte TATIN")
	status(t, response, 200)
	joined := eventResponse(t, response)
	assertTally(t, joined.Vote, "Tarte Tatin=2")
	if !chose(joined.Vote, tarte.ID) {
		t.Fatalf("matching label voted for another option: %+v", joined.Vote)
	}
	status(t, writeIn(t, a, first, event.ID, "TARTE TATIN"), 200)
	assertTally(t, voteOf(t, a, host, true, event.ID), "Tarte Tatin=2")

	status(t, writeIn(t, a, first, event.ID, "Mousse"), 200)
	moved := voteOf(t, a, first, false, event.ID)
	assertTally(t, moved, "Mousse=1 Tarte Tatin=1")
	mousse := optionLabeled(t, moved, "Mousse")
	response = castVote(t, a, second, event.ID, mousse.ID)
	status(t, response, 200)
	assertTally(t, eventResponse(t, response).Vote, "Mousse=2")
	if options := countRows(t, a, "SELECT COUNT(*) FROM programme_vote_options"); options != 1 {
		t.Fatalf("emptied write-in left %d options", options)
	}
	assertWelcomeError(t, castVote(t, a, first, event.ID, tarte.ID), 400, "invalid_vote_option")

	event = voteState(t, a, host, event, "closed")
	assertWelcomeError(t, writeIn(t, a, first, event.ID, "Flan"), 409, "vote_closed")
	assertWelcomeError(t, writeIn(t, a, first, event.ID, "mousse"), 409, "vote_closed")
	assertTally(t, voteOf(t, a, second, false, event.ID), "Mousse=2")

	guests := voteState(t, a, host, voteEvent(t, a, host, firstGuest.ID, secondGuest.ID), "open")
	assertWelcomeError(t, writeIn(t, a, first, guests.ID, "Someone"), 403, "write_ins_disabled")
}

func TestHostRemovesWriteInsButKeepsOwnOptions(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First")
	second, _, _ := guest(t, a, host, "Second")
	event := voteState(t, a, host, customVote(t, a, host, true, "Tarte", "Mousse"), "open")
	other := voteState(t, a, host, customVote(t, a, host, true), "open")
	status(t, writeIn(t, a, first, other.ID, "Elsewhere"), 200)
	foreign := optionLabeled(t, voteOf(t, a, first, false, other.ID), "Elsewhere")
	hostOption := optionLabeled(t, event.Vote, "Tarte")
	status(t, castVote(t, a, second, event.ID, hostOption.ID), 200)
	status(t, writeIn(t, a, first, event.ID, "Rude"), 200)
	status(t, writeIn(t, a, second, event.ID, "rude"), 200)
	rude := optionLabeled(t, voteOf(t, a, first, false, event.ID), "Rude")

	assertWelcomeError(t, removeOption(t, a, first, event.ID, rude.ID), 403, "admin_required")
	status(t, removeOption(t, a, nil, event.ID, rude.ID), 401)
	assertWelcomeError(t, removeOption(t, a, host, event.ID, hostOption.ID), 409, "activity_conflict")
	for _, unknown := range []int64{foreign.ID, 999999} {
		assertWelcomeError(t, removeOption(t, a, host, event.ID, unknown), 400, "invalid_vote_option")
	}
	assertWelcomeError(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/programme/%d/vote/options/rude", event.ID), nil, host), 400, "invalid_id")
	status(t, removeOption(t, a, host, 999999, rude.ID), 404)
	assertTally(t, voteOf(t, a, host, true, event.ID), "Rude=2 Mousse=0 Tarte=0")

	response := removeOption(t, a, host, event.ID, rude.ID)
	status(t, response, 200)
	removed := eventResponse(t, response)
	assertTally(t, removed.Vote, "Mousse=0 Tarte=0")
	if removed.Revision != event.Revision {
		t.Fatalf("moderation changed the revision: %d -> %d", event.Revision, removed.Revision)
	}
	if vote := voteOf(t, a, first, false, event.ID); vote.MyOptionID != nil || !vote.CanVote {
		t.Fatalf("removed option kept a ballot: %+v", vote)
	}
	if ballots := countRows(t, a, "SELECT COUNT(*) FROM programme_ballots b JOIN programme_activities a ON a.id=b.activity_id WHERE a.event_id=$1", event.ID); ballots != 0 {
		t.Fatalf("removed option kept %d ballots", ballots)
	}
	assertWelcomeError(t, removeOption(t, a, host, event.ID, rude.ID), 400, "invalid_vote_option")

	status(t, writeIn(t, a, first, event.ID, "Rude again"), 200)
	event = voteState(t, a, host, event, "closed")
	again := optionLabeled(t, event.Vote, "Rude again")
	response = removeOption(t, a, host, event.ID, again.ID)
	status(t, response, 200)
	assertTally(t, eventResponse(t, response).Vote, "Mousse=0 Tarte=0")
	assertTally(t, voteOf(t, a, first, false, other.ID), "Elsewhere=1")
}

func TestWriteInsStopAtTheOptionLimit(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First")
	second, _, _ := guest(t, a, host, "Second")
	event := voteState(t, a, host, customVote(t, a, host, true, numberedLabels(programme.OptionLimit-1)...), "open")
	status(t, writeIn(t, a, first, event.ID, "Last free choice"), 200)
	assertWelcomeError(t, writeIn(t, a, second, event.ID, "One too many"), 409, "vote_option_limit")
	status(t, writeIn(t, a, second, event.ID, "last FREE choice"), 200)
	status(t, writeIn(t, a, second, event.ID, "choice 005"), 200)
	full := voteOf(t, a, second, false, event.ID)
	if len(full.Options) != programme.OptionLimit || full.Options[0].Label != "Choice 005" || full.Options[1].Label != "Last free choice" {
		t.Fatalf("%d options, first=%q second=%q", len(full.Options), full.Options[0].Label, full.Options[1].Label)
	}
	status(t, castVote(t, a, first, event.ID, optionLabeled(t, full, "Choice 000").ID), 200)
	status(t, writeIn(t, a, second, event.ID, "One too many"), 200)
	if options := len(voteOf(t, a, second, false, event.ID).Options); options != programme.OptionLimit {
		t.Fatalf("options=%d", options)
	}
}

func TestConcurrentWriteInsOfOneLabelCreateOneOption(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	event := voteState(t, a, host, customVote(t, a, host, true), "open")
	const voters = 8
	actors := make([]programme.Actor, voters)
	for i := range actors {
		cookie, voter, _ := guest(t, a, host, fmt.Sprintf("Voter %d", i))
		actors[i] = programme.Actor{GuestID: voter.ID, SessionHash: identity.HashToken(cookie.Value)}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, voters)
	var work sync.WaitGroup
	for i, actor := range actors {
		work.Go(func() {
			<-start
			label := "Tarte Tatin"
			if i%2 == 1 {
				label = "  tarte TATIN "
			}
			_, err := a.programme.WriteIn(ctx, actor, event.ID, label)
			results <- err
		})
	}
	close(start)
	work.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatalf("concurrent write-in error: %v", err)
		}
	}
	vote := voteOf(t, a, host, false, event.ID)
	if len(vote.Options) != 1 || vote.Options[0].Votes != voters || !vote.Options[0].WriteIn {
		t.Fatalf("concurrent write-ins produced %s", tally(vote))
	}
	if label := vote.Options[0].Label; label != "Tarte Tatin" && label != "tarte TATIN" {
		t.Fatalf("stored label %q is not a trimmed spelling a guest typed", label)
	}
}

func TestVoteChangesInvalidateTheProgrammeOnlyWhenCommitted(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	voter, _, _ := guest(t, a, host, "Live voter")
	event := customVote(t, a, host, true, "Tarte", "Mousse")
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	sockets := []*testRealtimeConnection{dialRealtime(t, a, server, host), dialRealtime(t, a, server, voter)}
	for _, socket := range sockets {
		readRealtime(t, socket, "ready")
	}
	invalidated := func() {
		t.Helper()
		for _, socket := range sockets {
			readRealtime(t, socket, "invalidate", "programme")
		}
	}
	event = voteState(t, a, host, event, "open")
	invalidated()
	status(t, castVote(t, a, voter, event.ID, optionLabeled(t, event.Vote, "Tarte").ID), 200)
	invalidated()
	response := writeIn(t, a, voter, event.ID, "Flan")
	status(t, response, 200)
	invalidated()
	assertWelcomeError(t, writeIn(t, a, voter, event.ID, " "), 400, "invalid_vote_label")
	assertWelcomeError(t, castVote(t, a, voter, event.ID, 999999), 400, "invalid_vote_option")
	assertWelcomeError(t, removeOption(t, a, host, event.ID, optionLabeled(t, event.Vote, "Tarte").ID), 409, "activity_conflict")
	for _, socket := range sockets {
		noRealtime(t, socket)
	}
	status(t, removeOption(t, a, host, event.ID, optionLabeled(t, eventResponse(t, response).Vote, "Flan").ID), 200)
	invalidated()
	voteState(t, a, host, event, "closed")
	invalidated()
}

func TestProgrammeConcurrentVotesRemainUniqueAndCloseAtomically(t *testing.T) {
	a := testApp(t)
	host, h := admin(t, a)
	first, g, _ := guest(t, a, host, "First")
	second, c, _ := guest(t, a, host, "Second")
	event := voteEvent(t, a, host, h.ID, g.ID, c.ID)
	event = voteState(t, a, host, event, "open")
	firstOption, secondOption := optionOfGuest(t, event.Vote, g.ID), optionOfGuest(t, event.Vote, c.ID)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 17)
	var work sync.WaitGroup
	for i := range 16 {
		work.Go(func() {
			<-start
			cookie, guestID, optionID := first, g.ID, secondOption.ID
			if i%2 == 1 {
				cookie, guestID, optionID = second, c.ID, firstOption.ID
			}
			_, err := a.programme.Vote(ctx, programme.Actor{GuestID: guestID, SessionHash: identity.HashToken(cookie.Value)}, event.ID, optionID)
			results <- err
		})
	}
	work.Go(func() {
		<-start
		_, err := a.programme.Transition(ctx, programme.Actor{GuestID: h.ID, SessionHash: identity.HashToken(host.Value)}, event.ID, programme.VoteClosed, event.Revision)
		results <- err
	})
	close(start)
	work.Wait()
	close(results)
	for err := range results {
		if err != nil && err != programme.ErrVoteClosed {
			t.Fatalf("concurrent vote/close error: %v", err)
		}
	}
	if count := countRows(t, a, "SELECT COUNT(*) FROM programme_ballots WHERE activity_id=(SELECT id FROM programme_activities WHERE event_id=$1)", event.ID); count > 2 {
		t.Fatalf("duplicate ballots=%d", count)
	}
	assertWelcomeError(t, castVote(t, a, first, event.ID, optionOfGuest(t, event.Vote, h.ID).ID), 409, "vote_closed")
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
	hostOption := optionOfGuest(t, event.Vote, h.ID)
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
		_, err := a.programme.Vote(ctx, programme.Actor{GuestID: g.ID, SessionHash: identity.HashToken(visitor.Value)}, event.ID, hostOption.ID)
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
	if count := countRows(t, a, "SELECT COUNT(*) FROM programme_ballots"); count != 0 {
		t.Fatalf("expired ballot committed: %d", count)
	}
}

// The second migration runs against rows written in the baseline's shape.
func TestVoteOptionsMigrationConvertsCandidatesAndBallots(t *testing.T) {
	databaseURL := testDatabaseURL(t)
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	const baseline = "migrations/0001_baseline.sql"
	if err := applyMigrations(t.Context(), db, fstest.MapFS{baseline: migrationFiles(t)[baseline]}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
INSERT INTO guests(name,role) VALUES ('Ada','guest'),('Bo','guest'),('Cy','guest');
INSERT INTO events(title,description,teaser) VALUES ('Open vote','',''),('Revealed vote','','');
INSERT INTO programme_activities(event_id,type,revision)
 SELECT id,'vote',id+4 FROM events ORDER BY id;
INSERT INTO programme_votes(activity_id,question,status,allow_self_vote)
 SELECT a.id,e.title,CASE e.title WHEN 'Open vote' THEN 'open' ELSE 'revealed' END,e.title='Open vote'
 FROM programme_activities a JOIN events e ON e.id=a.event_id;
INSERT INTO programme_vote_candidates(activity_id,guest_id,position)
 SELECT v.activity_id,g.id,c.position
 FROM (VALUES ('Open vote','Cy',0),('Open vote','Ada',1),('Revealed vote','Ada',0),('Revealed vote','Bo',1)) AS c(question,name,position)
 JOIN programme_votes v ON v.question=c.question JOIN guests g ON g.name=c.name;
INSERT INTO programme_ballots(activity_id,guest_id,candidate_id)
 SELECT v.activity_id,voter.id,candidate.id
 FROM (VALUES ('Open vote','Ada','Cy'),('Open vote','Bo','Cy'),('Open vote','Cy','Ada'),('Revealed vote','Cy','Bo')) AS b(question,voter,candidate)
 JOIN programme_votes v ON v.question=b.question JOIN guests voter ON voter.name=b.voter JOIN guests candidate ON candidate.name=b.candidate;
`); err != nil {
		t.Fatal(err)
	}
	if err := applyMigrations(t.Context(), db, migrationFiles(t)); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct{ name, query, want string }{
		{"vote settings", `SELECT string_agg(question||':'||status||':'||choices||':'||allow_self_vote||':'||allow_write_ins,' ' ORDER BY question)
 FROM programme_votes`, "Open vote:open:guests:true:false Revealed vote:closed:guests:false:false"},
		{"options in candidate order", `SELECT string_agg(v.question||':'||g.name||':'||(o.label IS NULL)||':'||o.write_in,' ' ORDER BY o.id)
 FROM programme_vote_options o JOIN programme_votes v ON v.activity_id=o.activity_id JOIN guests g ON g.id=o.guest_id`,
			"Open vote:Cy:true:false Open vote:Ada:true:false Revealed vote:Ada:true:false Revealed vote:Bo:true:false"},
		{"ballots follow their candidate", `SELECT string_agg(v.question||':'||voter.name||'>'||chosen.name,' ' ORDER BY v.question,voter.name)
 FROM programme_ballots b JOIN programme_votes v ON v.activity_id=b.activity_id JOIN guests voter ON voter.id=b.guest_id
 JOIN programme_vote_options o ON o.activity_id=b.activity_id AND o.id=b.option_id JOIN guests chosen ON chosen.id=o.guest_id`,
			"Open vote:Ada>Cy Open vote:Bo>Cy Open vote:Cy>Ada Revealed vote:Cy>Bo"},
		{"revisions", "SELECT string_agg(revision::text,' ' ORDER BY id) FROM programme_activities", "5 6"},
		{"dropped candidates", `SELECT (to_regclass('programme_vote_candidates') IS NULL)::text||':'||(SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema=current_schema() AND table_name='programme_ballots' AND column_name='candidate_id')`, "true:0"},
	} {
		var got string
		if err := db.QueryRow(test.query).Scan(&got); err != nil || got != test.want {
			t.Fatalf("%s: got %q error=%v, want %q", test.name, got, err, test.want)
		}
	}
	for name, refused := range map[string]string{
		"revealed status":            "UPDATE programme_votes SET status='revealed'",
		"write-ins on a guests vote": "UPDATE programme_votes SET allow_write_ins=TRUE",
		"self-vote on a custom vote": "UPDATE programme_votes SET choices='custom'",
		"option with guest and label": `INSERT INTO programme_vote_options(activity_id,guest_id,label,created_at)
 SELECT activity_id,guest_id,'Both',CURRENT_TIMESTAMP FROM programme_vote_options LIMIT 1`,
		"option without guest or label": "INSERT INTO programme_vote_options(activity_id,created_at) SELECT activity_id,CURRENT_TIMESTAMP FROM programme_votes LIMIT 1",
		"guest listed twice":            "INSERT INTO programme_vote_options(activity_id,guest_id,created_at) SELECT activity_id,guest_id,CURRENT_TIMESTAMP FROM programme_vote_options LIMIT 1",
		"write-in guest":                "UPDATE programme_vote_options SET write_in=TRUE",
		"labels differing by case": `INSERT INTO programme_vote_options(activity_id,label,created_at)
 SELECT activity_id,label,CURRENT_TIMESTAMP FROM programme_votes CROSS JOIN (VALUES ('Tarte'),('tARTE')) AS l(label) WHERE status='closed'`,
		"long label":                       "INSERT INTO programme_vote_options(activity_id,label,created_at) SELECT activity_id,repeat('x',81),CURRENT_TIMESTAMP FROM programme_votes LIMIT 1",
		"ballot for another vote's option": `UPDATE programme_ballots b SET option_id=(SELECT MIN(id) FROM programme_vote_options o WHERE o.activity_id<>b.activity_id)`,
	} {
		if _, err := db.Exec(refused); err == nil {
			t.Fatalf("schema accepted %s", name)
		}
	}

	a, err := Open(Config{PublicURL: "http://localhost:3000", DataDir: t.TempDir(), DatabaseURL: databaseURL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	host, _ := admin(t, a)
	votes := programmeEvents(t, a, host, true)
	if len(votes) != 2 || votes[0].Vote.Status != programme.VoteOpen || votes[1].Vote.Status != programme.VoteClosed || !votes[0].Vote.AllowSelfVote {
		t.Fatalf("migrated programme=%+v", votes)
	}
	assertTally(t, votes[0].Vote, "Cy=2 Ada=1")
	assertTally(t, votes[1].Vote, "Bo=1 Ada=0")
	status(t, castVote(t, a, host, votes[0].ID, optionLabeled(t, votes[0].Vote, "Ada").ID), 200)
	assertTally(t, voteOf(t, a, host, false, votes[0].ID), "Ada=2 Cy=2")
}
