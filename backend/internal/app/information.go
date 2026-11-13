package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/information"
)

func (a *App) getInformation(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	view, err := a.information.View(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, view)
}

func (a *App) getAdminInformation(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	page, err := a.information.Page(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, page)
}

func (a *App) updateInformation(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	var input struct {
		Revision *int64            `json:"revision"`
		Enabled  *bool             `json:"enabled"`
		Tabs     []information.Tab `json:"tabs"`
	}
	// Eight texts of 4,000 characters can exceed the usual 64 KiB JSON limit.
	if !decodeLimit(w, r, &input, 256<<10) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Enabled == nil || input.Tabs == nil {
		fail(w, "invalid_body")
		return
	}
	page, err := a.information.Update(r.Context(), *input.Revision, information.Page{Enabled: *input.Enabled, Tabs: input.Tabs})
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, page)
}
