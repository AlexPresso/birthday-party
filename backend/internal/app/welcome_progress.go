package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/welcome"
)

func (a *App) getWelcome(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	view, err := a.welcome.View(r.Context(), viewer.Guest.ID)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, view)
}

func (a *App) acceptWelcomeRules(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Revision *int64 `json:"revision"`
		Accepted *bool  `json:"accepted"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Accepted == nil {
		fail(w, "invalid_body")
		return
	}
	view, err := a.welcome.AcceptRules(r.Context(), viewer.Guest.ID, *input.Revision, *input.Accepted)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(viewer.Guest.ID, realtimeWelcome)
	respond(w, http.StatusOK, view)
}

func (a *App) transitionGuestWelcome(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Revision *int64         `json:"revision"`
		Action   welcome.Action `json:"action"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 {
		fail(w, "invalid_body")
		return
	}
	view, err := a.welcome.Navigate(r.Context(), viewer.Guest.ID, *input.Revision, input.Action)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(viewer.Guest.ID, realtimeWelcome)
	respond(w, http.StatusOK, view)
}
