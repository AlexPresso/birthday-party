package app

import (
	"context"
	"net/http"
	"time"

	"birthday-party/backend/internal/access"
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
		fail(w, "too_many_attempts")
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
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, preview)
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
		failError(w, err)
		return
	}
	http.SetCookie(w, a.sessionCookie(session.Token, session.ExpiresAt, int(identity.SessionTTL.Seconds())))
	a.realtime.notify(session.Guest.ID, realtimeAuth)
	respond(w, http.StatusOK, map[string]any{"guest": session.Guest})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	if err := a.identity.Logout(r.Context(), viewer.SessionHash); err != nil {
		failError(w, err)
		return
	}
	a.realtime.endSessions(0, viewer.SessionHash)
	http.SetCookie(w, a.sessionCookie("", time.Unix(1, 0), -1))
	w.WriteHeader(http.StatusNoContent)
}

// sessionCookie keeps path "/" so Next.js server rendering receives the session too.
func (a *App) sessionCookie(value string, expires time.Time, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name: cookieName, Value: value, Path: "/", Expires: expires, MaxAge: maxAge,
		HttpOnly: true, Secure: a.config.CookieSecure, SameSite: http.SameSiteLaxMode,
	}
}
