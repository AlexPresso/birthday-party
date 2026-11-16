package app

import (
	"net/http"
	"time"

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

// getWaitingDetails tells a guest who came in, but waits for the welcome, the
// host's message and when and where the party is. It needs only a session:
// the rest of the party stays behind the welcome.
func (a *App) getWaitingDetails(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	details, err := a.party.Get(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	// Go decides when a guest may come in; the page only counts down to it.
	started := viewer.Guest.IsAdmin() || details.Date == nil
	if !started {
		startsAt, err := time.Parse(time.RFC3339Nano, *details.Date)
		started = err == nil && !a.now().Before(startsAt)
	}
	respond(w, http.StatusOK, map[string]any{
		"started":  started,
		"message":  configuration.WaitingMessage,
		"date":     details.Date,
		"timezone": details.Timezone,
		"location": details.Location,
		"mapUrl":   details.MapURL,
	})
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
