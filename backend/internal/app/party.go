package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/party"
)

func (a *App) getParty(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	details, err := a.party.Get(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, details)
}

func (a *App) updateParty(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input party.Party
	if !decode(w, r, &input) {
		return
	}
	details, err := a.party.Update(r.Context(), input)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, details)
}
