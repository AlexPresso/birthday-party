package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type invitation struct {
	InvitationURL string `json:"invitationUrl"`
	ExpiresAt     string `json:"expiresAt"`
}

func (a *App) issueInvitation(ctx context.Context, tx *sql.Tx, id int64) (invitation, error) {
	token, err := newToken()
	if err != nil {
		return invitation{}, err
	}
	expires := a.now().Add(invitationTTL)
	if _, err = tx.ExecContext(ctx, "DELETE FROM invitations WHERE guest_id=$1", id); err != nil {
		return invitation{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO invitations(token_hash,guest_id,expires_at) VALUES($1,$2,$3)", hashToken(token), id, expires.Unix())
	return invitation{InvitationURL: a.config.PublicURL + "/invitation#token=" + token, ExpiresAt: stamp(expires)}, err
}

// StartupAdminInvitation reuses the oldest active administrator without changing sessions.
func (a *App) StartupAdminInvitation(ctx context.Context) (string, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return "", err
	}
	var id int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM guests WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, "INSERT INTO guests(name,role) VALUES('Admin','admin') RETURNING id").Scan(&id)
	}
	if err != nil {
		return "", err
	}
	issued, err := a.issueInvitation(ctx, tx, id)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return issued.InvitationURL, nil
}

// InviteAdmin runs locally; no public route can create an administrator.
func (a *App) InviteAdmin(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return "", errors.New("name must contain 1–80 characters")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return "", err
	}
	var id int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM guests WHERE name=$1 AND role='admin' AND active=1 ORDER BY id LIMIT 1", name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, "INSERT INTO guests(name,role) VALUES($1,'admin') RETURNING id", name).Scan(&id)
	}
	if err != nil {
		return "", err
	}
	issued, err := a.issueInvitation(ctx, tx, id)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return issued.InvitationURL, nil
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
	if !validToken(input.Token) {
		fail(w, 401, "invalid_invitation")
		return
	}
	var name string
	var expires int64
	err := a.db.QueryRowContext(r.Context(), `SELECT g.name,i.expires_at FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>$2 AND g.active=1`, hashToken(input.Token), a.now().Unix()).Scan(&name, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 401, "invitation_unavailable")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"guestName": name, "expiresAt": stamp(time.Unix(expires, 0))})
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
	if !validToken(input.Token) {
		fail(w, 401, "invalid_invitation")
		return
	}
	ctx := r.Context()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	var guest Guest
	var avatarVersion int64
	now := a.now()
	// Lock the guest before the invitation, matching renewal and revocation.
	err = tx.QueryRowContext(ctx, `SELECT g.id,g.name,g.role,g.active,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>$2 AND g.active=1 FOR UPDATE OF g`, hashToken(input.Token), now.Unix()).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active, &avatarVersion)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 401, "invitation_unavailable")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	result, err := tx.ExecContext(ctx, "UPDATE invitations SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL AND expires_at>$3", now.Unix(), hashToken(input.Token), now.Unix())
	if err != nil {
		internal(w, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		internal(w, err)
		return
	}
	if count != 1 {
		fail(w, 401, "invitation_used")
		return
	}
	token, err := newToken()
	if err != nil {
		internal(w, err)
		return
	}
	expires := now.Add(sessionTTL)
	// Keep at most five browser sessions per guest, and discard expired rows.
	_, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<=$1", now.Unix())
	if err != nil {
		internal(w, err)
		return
	}
	_, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE guest_id=$1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE guest_id=$2 ORDER BY created_at DESC,token_hash DESC LIMIT 4)", guest.ID, guest.ID)
	if err != nil {
		internal(w, err)
		return
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,guest_id,created_at,expires_at) VALUES($1,$2,$3,$4)", hashToken(token), guest.ID, now.Unix(), expires.Unix())
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", Expires: expires, MaxAge: int(sessionTTL.Seconds()), HttpOnly: true, Secure: a.config.CookieSecure, SameSite: http.SameSiteLaxMode})
	guest.AvatarURL = avatarURL(guest.ID, avatarVersion)
	respond(w, 200, map[string]any{"guest": guest})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request, _ Guest) {
	cookie, _ := r.Cookie(cookieName)
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", hashToken(cookie.Value)); err != nil {
		internal(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", Expires: time.Unix(1, 0), MaxAge: -1, HttpOnly: true, Secure: a.config.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(204)
}

func (a *App) listGuests(w http.ResponseWriter, r *http.Request, _ Guest) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,name,role,active,CASE WHEN avatar_jpeg IS NOT NULL THEN avatar_version ELSE 0 END FROM guests ORDER BY active DESC,name,id LIMIT 500")
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Guest{}
	for rows.Next() {
		var guest Guest
		var avatarVersion int64
		if err := rows.Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active, &avatarVersion); err != nil {
			internal(w, err)
			return
		}
		guest.AvatarURL = avatarURL(guest.ID, avatarVersion)
		items = append(items, guest)
	}
	if err := rows.Err(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) createGuest(w http.ResponseWriter, r *http.Request, _ Guest) {
	var input struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 80 {
		fail(w, 400, "invalid_guest_name")
		return
	}
	ctx := r.Context()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		internal(w, err)
		return
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM guests").Scan(&count); err != nil {
		internal(w, err)
		return
	}
	if count >= 500 {
		fail(w, 409, "guest_limit_reached")
		return
	}
	var id int64
	err = tx.QueryRowContext(ctx, "INSERT INTO guests(name,role) VALUES($1,'guest') RETURNING id", input.Name).Scan(&id)
	if err != nil {
		internal(w, err)
		return
	}
	issued, err := a.issueInvitation(ctx, tx, id)
	if err != nil {
		internal(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 201, map[string]any{"guest": Guest{ID: id, Name: input.Name, Role: "guest", Active: true}, "invitationUrl": issued.InvitationURL, "expiresAt": issued.ExpiresAt})
}

func (a *App) renewInvitation(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), "UPDATE guests SET active=1 WHERE id=$1", id)
	if !affected(w, result, err) {
		return
	}
	issued, err := a.issueInvitation(r.Context(), tx, id)
	if err != nil {
		internal(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, issued)
}

func (a *App) revokeGuest(w http.ResponseWriter, r *http.Request, guest Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if id == guest.ID {
		fail(w, 409, "self_revoke_forbidden")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), "UPDATE guests SET active=0 WHERE id=$1", id)
	if !affected(w, result, err) {
		return
	}
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE guest_id=$1", id); err != nil {
		internal(w, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM invitations WHERE guest_id=$1", id); err != nil {
		internal(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	w.WriteHeader(204)
}
