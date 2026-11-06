package app

import (
	"birthday-party/backend/internal/identity"
	"net/http"
)

func (a *App) readQuestions(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	round, err := a.questions.Read(r.Context(), programmeActor(r, guest), id, guest.Role == "admin")
	if err != nil {
		failVote(w, err)
		return
	}
	respond(w, 200, round)
}

func (a *App) addQuestion(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Body string `json:"body"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Add(r.Context(), programmeActor(r, guest), id, input.Body)
	if err != nil {
		failVote(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, 201, round)
}

func (a *App) upvoteQuestion(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		QuestionID int64 `json:"questionId"`
		Upvoted    bool  `json:"upvoted"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Upvote(r.Context(), programmeActor(r, guest), id, input.QuestionID, input.Upvoted)
	if err != nil {
		failVote(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, 200, round)
}

func (a *App) transitionQuestions(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Status   string `json:"status"`
		Revision int64  `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Transition(r.Context(), programmeActor(r, guest), id, input.Status, input.Revision)
	if err != nil {
		failVote(w, err)
		return
	}
	a.programmeChanged()
	respond(w, 200, round)
}

func (a *App) resolveQuestion(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		QuestionID int64  `json:"questionId"`
		Status     string `json:"status"`
		Revision   int64  `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Resolve(r.Context(), programmeActor(r, guest), id, input.QuestionID, input.Status, input.Revision)
	if err != nil {
		failVote(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, 200, round)
}
