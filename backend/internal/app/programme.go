package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

func (a *App) listProgramme(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	a.events(w, r, guest, false)
}
func (a *App) listAdminProgramme(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	a.events(w, r, guest, true)
}

func (a *App) events(w http.ResponseWriter, r *http.Request, guest identity.Guest, private bool) {
	items, err := a.programme.List(r.Context(), a.now, guest.ID, private)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) createEvent(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	var input programme.Input
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Create(r.Context(), programmeActor(r, guest), input)
	if err != nil {
		failVote(w, err)
		return
	}
	a.programmeChanged()
	respond(w, 201, event.View(a.now(), true))
}

func (a *App) updateEvent(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input programme.Input
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Update(r.Context(), programmeActor(r, guest), id, input)
	if err != nil {
		failVote(w, err)
		return
	}
	a.programmeChanged()
	respond(w, 200, event.View(a.now(), true))
}

func (a *App) deleteEvent(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.programme.Delete(r.Context(), programmeActor(r, guest), id); err != nil {
		failVote(w, err)
		return
	}
	a.programmeChanged()
	w.WriteHeader(204)
}

func failProgramme(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, programme.ErrInvalidEvent):
		fail(w, 400, "invalid_event")
	case errors.Is(err, programme.ErrInvalidDate):
		fail(w, 400, "invalid_date")
	case errors.Is(err, programme.ErrLimitReached):
		fail(w, 409, "event_limit_reached")
	case errors.Is(err, programme.ErrNotFound):
		fail(w, 404, "not_found")
	default:
		internal(w, err)
	}
}
