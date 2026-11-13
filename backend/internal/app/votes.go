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
		OptionID int64 `json:"optionId"`
	}
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Vote(r.Context(), programmeActor(viewer), eventID, input.OptionID)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, event)
}

// castWriteIn votes for the label the guest typed, adding it to the options
// when no option carries it yet.
func (a *App) castWriteIn(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	eventID, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Label string `json:"label"`
	}
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.WriteIn(r.Context(), programmeActor(viewer), eventID, input.Label)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, event)
}

func (a *App) removeVoteOption(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	eventID, ok := pathID(w, r)
	if !ok {
		return
	}
	optionID, ok := pathValueID(w, r, "optionId")
	if !ok {
		return
	}
	event, err := a.programme.RemoveOption(r.Context(), programmeActor(viewer), eventID, optionID)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, http.StatusOK, event)
}
