package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/notifications"
)

func (a *App) getNotifications(w http.ResponseWriter, _ *http.Request, _ access.Viewer) {
	respond(w, http.StatusOK, map[string]string{"publicKey": a.notificationKeys.Public})
}

func notificationEndpoint(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input struct {
		Endpoint string `json:"endpoint"`
	}
	if !decodeLimit(w, r, &input, 4096) {
		return "", false
	}
	return input.Endpoint, true
}

func (a *App) notificationStatus(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	subscribed, err := a.notifications.Status(r.Context(), viewer.Guest.ID, viewer.SessionHash, endpoint)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"subscribed": subscribed})
}

func (a *App) deleteNotificationSubscription(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	if err := a.notifications.Delete(r.Context(), viewer.Guest.ID, viewer.SessionHash, endpoint); err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusNoContent, nil)
}

func (a *App) saveNotificationSubscription(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input notifications.Subscription
	if !decodeLimit(w, r, &input, 8192) {
		return
	}
	if err := a.notifications.Save(r.Context(), viewer.Guest, viewer.SessionHash, input); err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"subscribed": true})
}
