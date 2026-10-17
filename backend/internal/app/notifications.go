package app

import (
	"context"
	"crypto/elliptic"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type notificationKeys struct {
	Public  string
	Private string
}

func notificationSubject(value, publicURL string) (string, error) {
	if value == "" {
		if validNotificationEndpoint(publicURL) {
			return publicURL, nil
		}
		return "mailto:notifications@example.invalid", nil
	}
	u, err := url.Parse(value)
	if err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Fragment == "" {
		return value, nil
	}
	if strings.HasPrefix(value, "mailto:") {
		address := strings.TrimPrefix(value, "mailto:")
		parsed, err := mail.ParseAddress(address)
		if err == nil && parsed.Address == address && parsed.Name == "" {
			return value, nil
		}
	}
	return "", errors.New("VAPID_SUBJECT must be an HTTPS URL or a mailto address")
}

func loadNotificationKeys(ctx context.Context, db *sql.DB) (notificationKeys, error) {
	var keys notificationKeys
	err := db.QueryRowContext(ctx, "SELECT public_key,private_key FROM notification_keys WHERE id=1").Scan(&keys.Public, &keys.Private)
	if !errors.Is(err, sql.ErrNoRows) {
		return keys, err
	}
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return keys, err
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO notification_keys(id,public_key,private_key) VALUES(1,$1,$2) ON CONFLICT(id) DO NOTHING", public, private); err != nil {
		return keys, err
	}
	err = db.QueryRowContext(ctx, "SELECT public_key,private_key FROM notification_keys WHERE id=1").Scan(&keys.Public, &keys.Private)
	return keys, err
}

func (a *App) getNotifications(w http.ResponseWriter, _ *http.Request, _ Guest) {
	respond(w, 200, map[string]string{"publicKey": a.notificationKeys.Public})
}

func notificationEndpoint(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input struct {
		Endpoint string `json:"endpoint"`
	}
	if !decodeLimit(w, r, &input, 4096) {
		return "", false
	}
	if !validNotificationEndpoint(input.Endpoint) {
		fail(w, 400, "invalid_notification_subscription")
		return "", false
	}
	return input.Endpoint, true
}

func (a *App) notificationStatus(w http.ResponseWriter, r *http.Request, guest Guest) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	cookie, _ := r.Cookie(cookieName)
	var subscribed bool
	err := a.db.QueryRowContext(r.Context(), "SELECT EXISTS(SELECT 1 FROM notification_subscriptions WHERE endpoint_hash=$1 AND guest_id=$2 AND session_hash=$3)", hashToken(endpoint), guest.ID, hashToken(cookie.Value)).Scan(&subscribed)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]bool{"subscribed": subscribed})
}

func (a *App) deleteNotificationSubscription(w http.ResponseWriter, r *http.Request, guest Guest) {
	endpoint, ok := notificationEndpoint(w, r)
	if !ok {
		return
	}
	cookie, _ := r.Cookie(cookieName)
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM notification_subscriptions WHERE endpoint_hash=$1 AND guest_id=$2 AND session_hash=$3", hashToken(endpoint), guest.ID, hashToken(cookie.Value)); err != nil {
		internal(w, err)
		return
	}
	respond(w, http.StatusNoContent, nil)
}

func (a *App) saveNotificationSubscription(w http.ResponseWriter, r *http.Request, guest Guest) {
	var input struct {
		Endpoint string       `json:"endpoint"`
		Keys     webpush.Keys `json:"keys"`
		Locale   string       `json:"locale"`
	}
	if !decodeLimit(w, r, &input, 8192) {
		return
	}
	key, keyError := base64.RawURLEncoding.Strict().DecodeString(strings.TrimRight(input.Keys.P256dh, "="))
	auth, authError := base64.RawURLEncoding.Strict().DecodeString(strings.TrimRight(input.Keys.Auth, "="))
	x, _ := elliptic.Unmarshal(elliptic.P256(), key)
	validLocale := input.Locale == "en" || input.Locale == "fr" || input.Locale == "de" || input.Locale == "it" || input.Locale == "es"
	if !validNotificationEndpoint(input.Endpoint) || len(input.Keys.P256dh) > 88 || len(input.Keys.Auth) > 24 || keyError != nil || authError != nil || len(auth) != 16 || x == nil || !validLocale {
		fail(w, 400, "invalid_notification_subscription")
		return
	}
	ctx := r.Context()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	var active bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&active); err != nil {
		internal(w, err)
		return
	}
	if !active {
		fail(w, 401, "access_revoked")
		return
	}
	cookie, _ := r.Cookie(cookieName)
	session := hashToken(cookie.Value)
	var sessionGuestID int64
	err = tx.QueryRowContext(ctx, "SELECT guest_id FROM sessions WHERE token_hash=$1 AND guest_id=$2 AND expires_at>$3 FOR SHARE", session, guest.ID, a.now().Unix()).Scan(&sessionGuestID)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 401, "session_expired")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	view, err := currentGuestWelcome(ctx, tx, guest.ID)
	if err != nil {
		internal(w, err)
		return
	}
	allowed := view.Open || guest.Role == "admin"
	if view.Step != nil {
		for _, widget := range view.Step.Widgets {
			allowed = allowed || widget.Type == "enable_notifications"
		}
	}
	if !allowed {
		fail(w, http.StatusLocked, "welcome_required")
		return
	}
	endpointHash := hashToken(input.Endpoint)
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM notification_subscriptions WHERE guest_id=$1 AND endpoint_hash<>$2", guest.ID, endpointHash).Scan(&count); err != nil {
		internal(w, err)
		return
	}
	if count >= 10 {
		fail(w, 409, "notification_subscription_limit")
		return
	}
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO notification_subscriptions(endpoint_hash,endpoint,p256dh,auth,guest_id,session_hash,locale)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(endpoint_hash) DO UPDATE
 SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,
 guest_id=excluded.guest_id,session_hash=excluded.session_hash,locale=excluded.locale,
 version=notification_subscriptions.version+1 RETURNING id`, endpointHash, input.Endpoint, base64.RawURLEncoding.EncodeToString(key), base64.RawURLEncoding.EncodeToString(auth), guest.ID, session, input.Locale).Scan(&id)
	if err != nil {
		internal(w, err)
		return
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM notification_outbox WHERE subscription_id=$1", id); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]bool{"subscribed": true})
}
