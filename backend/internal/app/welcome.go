package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

func failWelcome(w http.ResponseWriter, err error) {
	var rejected welcome.Error
	if !errors.As(err, &rejected) {
		internal(w, err)
		return
	}
	status := http.StatusConflict
	switch rejected {
	case welcome.ErrInvalidSteps, welcome.ErrInvalidAction:
		status = http.StatusBadRequest
	case welcome.ErrCategoryNotFound:
		status = http.StatusNotFound
	}
	fail(w, status, string(rejected))
}

func (a *App) getAdminWelcome(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	state, err := a.welcome.State(r.Context())
	if err != nil {
		failWelcome(w, err)
		return
	}
	respond(w, 200, state)
}

func (a *App) updateWelcome(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	var input struct {
		Revision *int64         `json:"revision"`
		Steps    []welcome.Step `json:"steps"`
	}
	// The bounded widget collection can exceed the usual 64 KiB JSON limit.
	if !decodeLimit(w, r, &input, 1<<20) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 {
		fail(w, 400, "invalid_welcome_steps")
		return
	}
	state, err := a.welcome.Edit(r.Context(), *input.Revision, input.Steps)
	if err != nil {
		failWelcome(w, err)
		return
	}
	a.realtime.notify(0, realtimeWelcome)
	respond(w, 200, state)
}

func (a *App) transitionWelcome(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
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
	state, err := a.welcome.Transition(r.Context(), *input.Revision, input.Action)
	if err != nil {
		failWelcome(w, err)
		return
	}
	a.realtime.notify(0, realtimeWelcome)
	respond(w, 200, state)
}
