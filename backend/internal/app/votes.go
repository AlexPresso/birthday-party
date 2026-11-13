package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/programme"
)

func (a *App) transitionVote(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	eventID, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Status   programme.VoteStatus `json:"status"`
		Revision int64                `json:"revision"`
	}
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Transition(r.Context(), programmeActor(viewer), eventID, input.Status, input.Revision)
	if err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	respond(w, http.StatusOK, event)
}

func (a *App) castVote(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	eventID, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		CandidateID int64 `json:"candidateId"`
	}
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Vote(r.Context(), programmeActor(viewer), eventID, input.CandidateID)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, event)
}
