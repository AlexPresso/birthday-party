package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

func programmeActor(r *http.Request, guest identity.Guest) programme.Actor {
	cookie, _ := r.Cookie(cookieName)
	return programme.Actor{GuestID: guest.ID, SessionHash: identity.HashToken(cookie.Value)}
}

func (a *App) transitionVote(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	eventID, ok := pathID(w, r)
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
	event, err := a.programme.Transition(r.Context(), programmeActor(r, guest), eventID, input.Status, input.Revision)
	if err != nil {
		failVote(w, err)
		return
	}
	a.programmeChanged()
	respond(w, 200, event)
}

func (a *App) castVote(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
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
	event, err := a.programme.Vote(r.Context(), programmeActor(r, guest), eventID, input.CandidateID)
	if err != nil {
		failVote(w, err)
		return
	}
	a.realtime.notify(0, realtimeProgramme)
	respond(w, 200, event)
}

func failVote(w http.ResponseWriter, err error) {
	var rejected access.Error
	if errors.As(err, &rejected) {
		status := http.StatusUnauthorized
		if rejected == access.ErrAdmin {
			status = http.StatusForbidden
		}
		if rejected == access.ErrWelcome {
			status = http.StatusLocked
		}
		fail(w, status, string(rejected))
		return
	}
	var invalid programme.ActivityError
	if errors.As(err, &invalid) {
		status := http.StatusBadRequest
		if invalid == programme.ErrActivityConflict || invalid == programme.ErrVoteClosed || invalid == programme.ErrQuestionsClosed || invalid == programme.ErrQuestionLimit || invalid == programme.ErrNoJokers {
			status = http.StatusConflict
		}
		fail(w, status, string(invalid))
		return
	}
	failProgramme(w, err)
}
