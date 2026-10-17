package app

import (
	"net/http"

	"birthday-party/backend/internal/identity"
)

func (a *App) listGuests(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	items, err := a.identity.List(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) createGuest(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	var input struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &input) {
		return
	}
	guest, issued, err := a.identity.Create(r.Context(), input.Name, a.now)
	if err != nil {
		failIdentity(w, err)
		return
	}
	respond(w, 201, map[string]any{"guest": guest, "invitationUrl": issued.InvitationURL, "expiresAt": issued.ExpiresAt})
}

func (a *App) renewInvitation(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	issued, err := a.identity.RenewInvitation(r.Context(), id, a.now)
	if err != nil {
		failIdentity(w, err)
		return
	}
	respond(w, 200, issued)
}

func (a *App) revokeGuest(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.identity.Revoke(r.Context(), id, guest.ID); err != nil {
		failIdentity(w, err)
		return
	}
	a.realtime.endSessions(id, "")
	w.WriteHeader(204)
}
