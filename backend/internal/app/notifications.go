package app

import (
	"errors"
	"net/http"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/notifications"
)

func (a *App) getNotifications(w http.ResponseWriter, _ *http.Request, _ identity.Guest) {
	respond(w, 200, map[string]string{"publicKey": a.notificationKeys.Public})
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

func (a *App) notificationStatus(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	cookie, _ := r.Cookie(cookieName)
	subscribed, err := a.notifications.Status(r.Context(), guest.ID, identity.HashToken(cookie.Value), endpoint)
	if err != nil {
		failNotification(w, err)
		return
	}
	respond(w, 200, map[string]bool{"subscribed": subscribed})
}

func (a *App) deleteNotificationSubscription(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	cookie, _ := r.Cookie(cookieName)
	if err := a.notifications.Delete(r.Context(), guest.ID, identity.HashToken(cookie.Value), endpoint); err != nil {
		failNotification(w, err)
		return
	}
	respond(w, http.StatusNoContent, nil)
}

func (a *App) saveNotificationSubscription(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	var input notifications.Subscription
	if !decodeLimit(w, r, &input, 8192) {
		return
	}
	cookie, _ := r.Cookie(cookieName)
	if err := a.notifications.Save(r.Context(), guest, identity.HashToken(cookie.Value), input); err != nil {
		failNotification(w, err)
		return
	}
	respond(w, 200, map[string]bool{"subscribed": true})
}

func failNotification(w http.ResponseWriter, err error) {
	var rejected *notifications.Error
	if !errors.As(err, &rejected) {
		internal(w, err)
		return
	}
	status := http.StatusBadRequest
	switch rejected.Code {
	case "session_expired", "access_revoked":
		status = http.StatusUnauthorized
	case "welcome_required":
		status = http.StatusLocked
	case "notification_subscription_limit":
		status = http.StatusConflict
	}
	fail(w, status, rejected.Code)
}
