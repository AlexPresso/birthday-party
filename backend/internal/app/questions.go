package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/programme"
)

func (a *App) readQuestions(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	round, err := a.questions.Read(r.Context(), programmeActor(viewer), id, viewer.Guest.IsAdmin())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, round)
}

func (a *App) addQuestion(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
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
	round, err := a.questions.Add(r.Context(), programmeActor(viewer), id, input.Body)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusCreated, round)
}

func (a *App) upvoteQuestion(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
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
	round, err := a.questions.Upvote(r.Context(), programmeActor(viewer), id, input.QuestionID, input.Upvoted)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, round)
}

func (a *App) transitionQuestions(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Status   programme.RoundStatus `json:"status"`
		Revision int64                 `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Transition(r.Context(), programmeActor(viewer), id, input.Status, input.Revision)
	if err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	respond(w, http.StatusOK, round)
}

func (a *App) resolveQuestion(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		QuestionID int64                    `json:"questionId"`
		Status     programme.QuestionStatus `json:"status"`
		Revision   int64                    `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	round, err := a.questions.Resolve(r.Context(), programmeActor(viewer), id, input.QuestionID, input.Status, input.Revision)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, round)
}
