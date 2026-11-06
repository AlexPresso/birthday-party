package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

func questionRoundResponse(t *testing.T, response *httptest.ResponseRecorder) programme.QuestionRound {
	t.Helper()
	var round programme.QuestionRound
	if err := json.Unmarshal(response.Body.Bytes(), &round); err != nil {
		t.Fatal(err)
	}
	return round
}
func questionEvent(t *testing.T, a *App, host *http.Cookie) programme.Event {
	t.Helper()
	response := request(t, a, "POST", "/api/admin/programme", programme.Input{Type: "questions", Title: "No Filter"}, host)
	status(t, response, 201)
	return eventResponse(t, response)
}
func questionState(t *testing.T, a *App, host *http.Cookie, eventID int64, state string, revision int64) programme.QuestionRound {
	t.Helper()
	response := request(t, a, "POST", fmt.Sprintf("/api/admin/programme/%d/questions/state", eventID), map[string]any{"status": state, "revision": revision}, host)
	status(t, response, 200)
	return questionRoundResponse(t, response)
}

func TestQuestionsAreAnonymousRankedAndLimitedToTwoJokers(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "Question author")
	second, _, _ := guest(t, a, host, "Other participant")
	event := questionEvent(t, a, host)
	path := fmt.Sprintf("/api/programme/%d/questions", event.ID)
	adminPath := fmt.Sprintf("/api/admin/programme/%d/questions", event.ID)
	status(t, request(t, a, "POST", "/api/admin/programme", programme.Input{Type: "questions", Title: "Forbidden"}, first), 403)
	if len(programmeEvents(t, a, first, false)) != 0 {
		t.Fatal("draft round was visible")
	}
	status(t, request(t, a, "GET", path, nil, first), 404)
	status(t, request(t, a, "POST", path, map[string]string{"body": "Draft question"}, first), 404)
	status(t, request(t, a, "POST", adminPath+"/state", map[string]any{"status": "open", "revision": 1}, first), 403)
	round := questionState(t, a, host, event.ID, "open", event.Revision)
	for _, body := range []string{" ", strings.Repeat("a", 1001)} {
		assertWelcomeError(t, request(t, a, "POST", path, map[string]string{"body": body}, first), 400, "invalid_question")
	}
	for _, body := range []string{"First question?", "Second question?", "Third question?"} {
		response := request(t, a, "POST", path, map[string]string{"body": body}, first)
		status(t, response, 201)
		round = questionRoundResponse(t, response)
	}
	ids := []int64{round.Items[0].ID, round.Items[1].ID, round.Items[2].ID}
	for _, cookie := range []*http.Cookie{first, first, second} {
		response := request(t, a, "PUT", path+"/upvote", map[string]any{"questionId": ids[1], "upvoted": true}, cookie)
		status(t, response, 200)
	}
	for _, cookie := range []*http.Cookie{first, second, host} {
		response := request(t, a, "GET", path, nil, cookie)
		status(t, response, 200)
		for _, private := range []string{`"guestId"`, `"guest_id"`, `"author"`, `"avatarUrl"`, `"name"`, "Question author"} {
			if strings.Contains(response.Body.String(), private) {
				t.Fatalf("identity leaked: %s", private)
			}
		}
		round = questionRoundResponse(t, response)
		if round.Items[0].ID != ids[1] || round.Items[0].Votes != 2 || round.Items[0].Upvoted != (cookie != host) {
			t.Fatalf("incorrect ranking or viewer vote: %+v", round.Items)
		}
	}
	response := request(t, a, "PUT", path+"/upvote", map[string]any{"questionId": ids[1], "upvoted": false}, first)
	status(t, response, 200)
	if questionRoundResponse(t, response).Items[0].Votes != 1 {
		t.Fatal("upvote was not removed")
	}
	status(t, request(t, a, "PUT", adminPath+"/resolve", map[string]any{"questionId": ids[0], "status": "joker", "revision": round.Revision}, first), 403)
	for _, id := range ids[:2] {
		response := request(t, a, "PUT", adminPath+"/resolve", map[string]any{"questionId": id, "status": "joker", "revision": round.Revision}, host)
		status(t, response, 200)
		round = questionRoundResponse(t, response)
	}
	assertWelcomeError(t, request(t, a, "PUT", adminPath+"/resolve", map[string]any{"questionId": ids[2], "status": "joker", "revision": round.Revision}, host), 409, "no_jokers_left")
	round = questionState(t, a, host, event.ID, "closed", round.Revision)
	assertWelcomeError(t, request(t, a, "POST", path, map[string]string{"body": "Late question"}, second), 409, "questions_closed")
	assertWelcomeError(t, request(t, a, "PUT", path+"/upvote", map[string]any{"questionId": ids[2], "upvoted": true}, second), 409, "questions_closed")
	response = request(t, a, "PUT", adminPath+"/resolve", map[string]any{"questionId": ids[2], "status": "answered", "revision": round.Revision}, host)
	status(t, response, 200)
	round = questionRoundResponse(t, response)
	if round.JokersUsed != 2 || round.QuestionCount != 3 {
		t.Fatalf("round=%+v", round)
	}
	response = request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Type: "questions", Title: "Corrected title", Revision: round.Revision}, host)
	status(t, response, 200)
	if saved := eventResponse(t, response); saved.Questions.JokersUsed != 2 || saved.Questions.QuestionCount != 3 {
		t.Fatalf("edit lost questions: %+v", saved)
	}
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/programme/%d", event.ID), nil, host), 204)
	var count int
	if err := a.db.QueryRow("SELECT (SELECT COUNT(*) FROM programme_questions)+(SELECT COUNT(*) FROM programme_question_upvotes)+(SELECT COUNT(*) FROM programme_question_rounds)").Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted round retained records: %d %v", count, err)
	}
}

func TestQuestionAccessAndConcurrentJokers(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	guestCookie, _, _ := guest(t, a, host, "Guest")
	event := questionEvent(t, a, host)
	round := questionState(t, a, host, event.ID, "open", event.Revision)
	path := fmt.Sprintf("/api/programme/%d/questions", event.ID)
	for _, body := range []string{"One?", "Two?", "Three?"} {
		response := request(t, a, "POST", path, map[string]string{"body": body}, guestCookie)
		status(t, response, 201)
		round = questionRoundResponse(t, response)
	}
	adminPath := fmt.Sprintf("/api/admin/programme/%d/questions/resolve", event.ID)
	response := request(t, a, "PUT", adminPath, map[string]any{"questionId": round.Items[0].ID, "status": "joker", "revision": round.Revision}, host)
	status(t, response, 200)
	round = questionRoundResponse(t, response)
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for _, question := range round.Items {
		if question.Status != "pending" {
			continue
		}
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			codes <- request(t, a, "PUT", adminPath, map[string]any{"questionId": id, "status": "joker", "revision": round.Revision}, host).Code
		}(question.ID)
	}
	wg.Wait()
	close(codes)
	successes, conflicts := 0, 0
	for code := range codes {
		if code == 200 {
			successes++
		} else if code == 409 {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent joker results: %d successes %d conflicts", successes, conflicts)
	}
	response = request(t, a, "GET", path, nil, host)
	status(t, response, 200)
	round = questionRoundResponse(t, response)
	if round.JokersUsed != 2 {
		t.Fatalf("joker budget changed: %d", round.JokersUsed)
	}
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	response = request(t, a, "PUT", fmt.Sprintf("/api/admin/programme/%d", event.ID), programme.Input{Title: "Private questions", Type: "questions", UnlockAt: &future, Revision: round.Revision}, host)
	status(t, response, 200)
	status(t, request(t, a, "GET", path, nil, guestCookie), 404)
	status(t, request(t, a, "POST", path, map[string]string{"body": "Locked?"}, guestCookie), 404)
	status(t, request(t, a, "PUT", path+"/upvote", map[string]any{"questionId": round.Items[0].ID, "upvoted": true}, guestCookie), 404)
	events := programmeEvents(t, a, guestCookie, false)
	if len(events) != 1 || !events[0].Locked || events[0].Questions != nil {
		t.Fatalf("locked activity leaked: %+v", events)
	}
	status(t, request(t, a, "GET", path, nil, nil), 401)
}

func TestQuestionLimitsWelcomeAndRevocationAreEnforced(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, viewer, _ := guest(t, a, host, "Question participant")
	event := questionEvent(t, a, host)
	questionState(t, a, host, event.ID, "open", event.Revision)
	path := fmt.Sprintf("/api/programme/%d/questions", event.ID)
	if _, err := a.db.Exec(`INSERT INTO programme_questions(activity_id,guest_id,body)
 SELECT a.id,$1,'Question '||n FROM programme_activities a CROSS JOIN generate_series(1,200) AS n WHERE a.event_id=$2`, viewer.ID, event.ID); err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, request(t, a, "POST", path, map[string]string{"body": "One too many"}, visitor), 409, "question_limit_reached")
	response := request(t, a, "GET", path, nil, visitor)
	status(t, response, 200)
	round := questionRoundResponse(t, response)
	if len(round.Items) != 200 {
		t.Fatal("question list truncated unexpectedly")
	}
	state := changeWelcome(t, a, host, 0, "start")
	status(t, request(t, a, "GET", path, nil, visitor), 423)
	status(t, request(t, a, "POST", path, map[string]string{"body": "During welcome"}, visitor), 423)
	actor := programme.Actor{GuestID: viewer.ID, SessionHash: identity.HashToken(visitor.Value)}
	if _, err := a.questions.Upvote(t.Context(), actor, event.ID, round.Items[0].ID, true); err != access.ErrWelcome {
		t.Fatalf("transaction bypassed welcome: %v", err)
	}
	changeWelcome(t, a, host, state.Revision, "open")
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", viewer.ID), nil, host), 204)
	status(t, request(t, a, "GET", path, nil, visitor), 401)
	if _, err := a.questions.Read(t.Context(), actor, event.ID, false); err != access.ErrExpired {
		t.Fatalf("transaction bypassed revocation: %v", err)
	}
}
