package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/party"
)

func (a *App) getParty(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	details, err := a.party.Get(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, details)
}

func (a *App) updateParty(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	var input party.Party
	if !decode(w, r, &input) {
		return
	}
	details, err := a.party.Update(r.Context(), input)
	if err != nil {
		var rejected party.Error
		if errors.As(err, &rejected) {
			fail(w, 400, string(rejected))
		} else {
			internal(w, err)
		}
		return
	}
	respond(w, 200, details)
}
