package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"birthday-party/backend/internal/identity"
)

// StartupAdminInvitation reuses the oldest active administrator without changing sessions.
func (a *App) StartupAdminInvitation(ctx context.Context) (string, error) {
	return a.identity.StartupAdminInvitation(ctx, a.now)
}

// InviteAdmin runs locally; no public route can create an administrator.
func (a *App) InviteAdmin(ctx context.Context, name string) (string, error) {
	return a.identity.InviteAdmin(ctx, name, a.now)
}

// A global bounded limiter also works behind the same-origin Next.js proxy,
// without trusting spoofable X-Forwarded-For headers or retaining client IPs.
func (a *App) allowInvitation(w http.ResponseWriter) bool {
	a.authMu.Lock()
	defer a.authMu.Unlock()
	now := a.now()
	if now.Sub(a.authWindow) >= time.Minute || now.Before(a.authWindow) {
		a.authWindow = now
		a.authCount = 0
	}
	a.authCount++
	if a.authCount > 120 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "too_many_attempts")
		return false
	}
	return true
}

func (a *App) previewInvitation(w http.ResponseWriter, r *http.Request) {
	if !a.allowInvitation(w) {
		return
	}
	var input struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &input) {
		return
	}
	preview, err := a.identity.PreviewInvitation(r.Context(), input.Token, a.now())
	if err != nil {
		failIdentity(w, err)
		return
	}
	respond(w, 200, preview)
}

func (a *App) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	if !a.allowInvitation(w) {
		return
	}
	var input struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &input) {
		return
	}
	session, err := a.identity.AcceptInvitation(r.Context(), input.Token, a.now)
	if err != nil {
		failIdentity(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: session.Token, Path: "/", Expires: session.ExpiresAt, MaxAge: int(identity.SessionTTL.Seconds()), HttpOnly: true, Secure: a.config.CookieSecure, SameSite: http.SameSiteLaxMode})
	a.realtime.notify(session.Guest.ID, realtimeAuth)
	respond(w, 200, map[string]any{"guest": session.Guest})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	cookie, _ := r.Cookie(cookieName)
	hash := identity.HashToken(cookie.Value)
	if err := a.identity.Logout(r.Context(), hash); err != nil {
		internal(w, err)
		return
	}
	a.realtime.endSessions(0, hash)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", Expires: time.Unix(1, 0), MaxAge: -1, HttpOnly: true, Secure: a.config.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(204)
}

func failIdentity(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, identity.ErrInvalidName):
		fail(w, 400, "invalid_guest_name")
	case errors.Is(err, identity.ErrInvalidInvitation):
		fail(w, 401, "invalid_invitation")
	case errors.Is(err, identity.ErrUnavailableInvitation):
		fail(w, 401, "invitation_unavailable")
	case errors.Is(err, identity.ErrUsedInvitation):
		fail(w, 401, "invitation_used")
	case errors.Is(err, identity.ErrLimitReached):
		fail(w, 409, "guest_limit_reached")
	case errors.Is(err, identity.ErrNotFound):
		fail(w, 404, "not_found")
	case errors.Is(err, identity.ErrSelfRevoke):
		fail(w, 409, "self_revoke_forbidden")
	default:
		internal(w, err)
	}
}
