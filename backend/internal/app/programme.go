package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/programme"
)

func programmeActor(viewer access.Viewer) programme.Actor {
	return programme.Actor{GuestID: viewer.Guest.ID, SessionHash: viewer.SessionHash}
}

func (a *App) getProgrammeNotifications(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	enabled, err := a.programme.Notifications(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (a *App) updateProgrammeNotifications(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Enabled == nil {
		fail(w, "invalid_body")
		return
	}
	if err := a.programme.SetNotifications(r.Context(), *input.Enabled); err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"enabled": *input.Enabled})
}

func (a *App) listProgramme(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	a.events(w, r, viewer, false)
}

func (a *App) listAdminProgramme(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	a.events(w, r, viewer, true)
}

func (a *App) events(w http.ResponseWriter, r *http.Request, viewer access.Viewer, private bool) {
	items, err := a.programme.List(r.Context(), a.now, viewer.Guest.ID, private)
	if err != nil {
		failError(w, err)
		return
	}
	respondCompressed(w, r, http.StatusOK, map[string]any{"items": items})
}

// readEvent returns one event with every vote option, for an activity page.
func (a *App) readEvent(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	event, err := a.programme.Event(r.Context(), a.now, viewer.Guest.ID, id, viewer.Guest.IsAdmin())
	if err != nil {
		failError(w, err)
		return
	}
	respondCompressed(w, r, http.StatusOK, event)
}

func (a *App) createEvent(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input programme.Input
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Create(r.Context(), programmeActor(viewer), input)
	if err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	respond(w, http.StatusCreated, event.View(a.now(), true))
}

func (a *App) updateEvent(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input programme.Input
	if !decode(w, r, &input) {
		return
	}
	event, err := a.programme.Update(r.Context(), programmeActor(viewer), id, input)
	if err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	respond(w, http.StatusOK, event.View(a.now(), true))
}

func (a *App) deleteEvent(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.programme.Delete(r.Context(), programmeActor(viewer), id); err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	w.WriteHeader(http.StatusNoContent)
}
