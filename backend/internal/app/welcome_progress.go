package app

import (
	"net/http"

	"birthday-party/backend/internal/identity"
)

func (a *App) getWelcome(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	view, err := a.welcome.View(r.Context(), guest.ID)
	if err != nil {
		failWelcome(w, err)
		return
	}
	respond(w, 200, view)
}

func (a *App) transitionGuestWelcome(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	var input struct {
		Revision *int64 `json:"revision"`
		Action   string `json:"action"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 {
		fail(w, 400, "invalid_body")
		return
	}
	view, err := a.welcome.Navigate(r.Context(), guest.ID, *input.Revision, input.Action)
	if err != nil {
		failWelcome(w, err)
		return
	}
	a.realtime.notify(guest.ID, realtimeWelcome)
	respond(w, 200, view)
}

func (a *App) updateWelcomeRequired(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	var input struct {
		Revision *int64 `json:"revision"`
		Required *bool  `json:"required"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Required == nil {
		fail(w, 400, "invalid_body")
		return
	}
	state, err := a.welcome.SetRequired(r.Context(), *input.Revision, *input.Required)
	if err != nil {
		failWelcome(w, err)
		return
	}
	a.realtime.notify(0, realtimeWelcome)
	respond(w, 200, state)
}
