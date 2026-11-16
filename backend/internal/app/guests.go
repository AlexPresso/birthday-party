package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
)

func (a *App) listGuests(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	items, err := a.identity.List(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"items": items})
}

func (a *App) createGuest(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input struct {
		Name  string `json:"name"`
		Phone string `json:"phone"`
	}
	if !decode(w, r, &input) {
		return
	}
	guest, issued, err := a.identity.Create(r.Context(), input.Name, input.Phone, a.now)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusCreated, map[string]any{"guest": guest, "invitationUrl": issued.InvitationURL, "expiresAt": issued.ExpiresAt})
}

// updateGuest renames a guest and sets their number. A changed number of a
// guest with access also answers the new invitation that replaced the old one.
func (a *App) updateGuest(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct {
		Name  string `json:"name"`
		Phone string `json:"phone"`
	}
	if !decode(w, r, &input) {
		return
	}
	guest, issued, err := a.identity.Update(r.Context(), id, input.Name, input.Phone, a.now)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"guest": guest, "invitation": issued})
}

func (a *App) renewInvitation(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	issued, err := a.identity.RenewInvitation(r.Context(), id, a.now)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, issued)
}

func (a *App) revokeGuest(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.identity.Revoke(r.Context(), id, viewer.Guest.ID); err != nil {
		failError(w, err)
		return
	}
	a.realtime.endSessions(id, "")
	w.WriteHeader(http.StatusNoContent)
}

// deleteGuest permanently removes a guest whose access was already removed.
// Their votes, upvotes and seats leave the programme, which guests refresh.
func (a *App) deleteGuest(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.identity.Delete(r.Context(), id, viewer.Guest.ID); err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	w.WriteHeader(http.StatusNoContent)
}
