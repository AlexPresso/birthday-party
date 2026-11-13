package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
)

func (a *App) listEntries(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	items, err := a.guestbook.List(r.Context(), viewer.Guest, before, limit)
	if err != nil {
		failError(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, http.StatusOK, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) createEntry(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Body      string `json:"body"`
		Anonymous bool   `json:"anonymous"`
	}
	if !decode(w, r, &input) {
		return
	}
	entry, err := a.guestbook.Create(r.Context(), viewer.Guest, input.Body, input.Anonymous, a.now())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusCreated, entry)
}

func (a *App) deleteEntry(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	deleted, err := a.guestbook.Delete(r.Context(), id, viewer.Guest)
	if err != nil {
		failError(w, err)
		return
	}
	if !deleted {
		fail(w, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
