package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/guestbook"
	"birthday-party/backend/internal/identity"
)

func (a *App) listEntries(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	items, err := a.guestbook.List(r.Context(), guest, before, limit)
	if err != nil {
		internal(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) createEntry(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	var input struct {
		Body      string `json:"body"`
		Anonymous bool   `json:"anonymous"`
	}
	if !decode(w, r, &input) {
		return
	}
	entry, err := a.guestbook.Create(r.Context(), guest, input.Body, input.Anonymous, a.now())
	if err != nil {
		failGuestbook(w, err)
		return
	}
	respond(w, 201, entry)
}

func (a *App) deleteEntry(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	deleted, err := a.guestbook.Delete(r.Context(), id, guest)
	if err != nil {
		failGuestbook(w, err)
		return
	}
	if !deleted {
		fail(w, 404, "not_found")
		return
	}
	w.WriteHeader(204)
}

func failGuestbook(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, guestbook.ErrInvalidMessage):
		fail(w, 400, "invalid_message")
	case errors.Is(err, guestbook.ErrNotFound):
		fail(w, 404, "message_not_found")
	case errors.Is(err, guestbook.ErrDeleteForbidden):
		fail(w, 403, "message_delete_forbidden")
	default:
		internal(w, err)
	}
}
