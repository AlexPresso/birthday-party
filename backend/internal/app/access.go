package app

import (
	"errors"
	"net/http"
	"strconv"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
)

const cookieName = "birthday_session"

func (a *App) auth(admin bool, next func(http.ResponseWriter, *http.Request, identity.Guest)) http.HandlerFunc {
	return a.authorize(admin, access.Session, next)
}

func (a *App) authContent(next func(http.ResponseWriter, *http.Request, identity.Guest)) http.HandlerFunc {
	return a.authorize(false, access.Party, next)
}

func (a *App) authProfile(next func(http.ResponseWriter, *http.Request, identity.Guest)) http.HandlerFunc {
	return a.authorize(false, access.Profile, next)
}

func (a *App) authorize(admin bool, scope access.Scope, next func(http.ResponseWriter, *http.Request, identity.Guest)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			fail(w, 401, "invitation_required")
			return
		}
		var targetID int64
		if target := r.PathValue("id"); target != "" {
			targetID, err = strconv.ParseInt(target, 10, 64)
			if err != nil || targetID <= 0 || target != strconv.FormatInt(targetID, 10) {
				targetID = -1
			}
		}
		guest, err := a.access.Authorize(r.Context(), cookie.Value, access.Request{Admin: admin, Scope: scope, TargetGuestID: targetID}, a.now())
		if err != nil {
			var rejected access.Error
			if !errors.As(err, &rejected) {
				internal(w, err)
				return
			}
			status := http.StatusUnauthorized
			switch rejected {
			case access.ErrAdmin:
				status = http.StatusForbidden
			case access.ErrWelcome:
				status = http.StatusLocked
			}
			fail(w, status, string(rejected))
			return
		}
		next(w, r, guest)
	}
}
