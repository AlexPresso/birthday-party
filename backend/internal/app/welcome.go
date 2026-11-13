package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/welcome"
)

func (a *App) getAdminWelcome(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	state, err := a.welcome.State(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, state)
}

func (a *App) updateWelcome(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input struct {
		Revision *int64         `json:"revision"`
		Steps    []welcome.Step `json:"steps"`
	}
	// The bounded widget collection can exceed the usual 64 KiB JSON limit.
	if !decodeLimit(w, r, &input, 1<<20) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 {
		fail(w, string(welcome.ErrInvalidSteps))
		return
	}
	state, err := a.welcome.Edit(r.Context(), *input.Revision, input.Steps)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeWelcome)
	respond(w, http.StatusOK, state)
}

func (a *App) transitionWelcome(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
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
	state, err := a.welcome.Transition(r.Context(), *input.Revision, input.Action)
	if err != nil {
		failError(w, err)
		return
	}
	// The transition committed its notifications to the durable outbox.
	a.notificationWake.notify()
	a.realtime.notify(0, realtimeWelcome)
	respond(w, http.StatusOK, state)
}

func (a *App) updateWelcomeRequired(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input struct {
		Revision *int64 `json:"revision"`
		Required *bool  `json:"required"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Required == nil {
		fail(w, "invalid_body")
		return
	}
	state, err := a.welcome.SetRequired(r.Context(), *input.Revision, *input.Required)
	if err != nil {
		failError(w, err)
		return
	}
	a.realtime.notify(0, realtimeWelcome)
	respond(w, http.StatusOK, state)
}
