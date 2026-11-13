package app

import (
	"net/http"
	"strconv"

	"birthday-party/backend/internal/access"
)

const cookieName = "birthday_session"

// handler serves a request for an authorized viewer.
type handler func(http.ResponseWriter, *http.Request, access.Viewer)

func (a *App) auth(admin bool, next handler) http.HandlerFunc {
	return a.authorize(admin, access.Session, next)
}

func (a *App) authContent(next handler) http.HandlerFunc {
	return a.authorize(false, access.Party, next)
}

func (a *App) authProfile(next handler) http.HandlerFunc {
	return a.authorize(false, access.Profile, next)
}

// authorize resolves the session cookie once per request and passes the viewer,
// including the session digest that write transactions recheck, to next.
func (a *App) authorize(admin bool, scope access.Scope, next handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil {
			fail(w, string(access.ErrInvitation))
			return
		}
		var targetID int64
		if target := r.PathValue("id"); target != "" {
			targetID, err = strconv.ParseInt(target, 10, 64)
			if err != nil || targetID <= 0 || target != strconv.FormatInt(targetID, 10) {
				targetID = -1
			}
		}
		viewer, err := a.access.Authorize(r.Context(), cookie.Value, access.Request{Admin: admin, Scope: scope, TargetGuestID: targetID}, a.now())
		if err != nil {
			failError(w, err)
			return
		}
		next(w, r, viewer)
	}
}
