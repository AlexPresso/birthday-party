package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const notificationLifetime = 15 * time.Minute

func (a *App) queueWelcomeNotifications(ctx context.Context, tx *sql.Tx, state welcomeState, action string) error {
	if action == "start" {
		_, err := tx.ExecContext(ctx, "DELETE FROM notification_outbox")
		return err
	}
	kind := "welcome_step"
	if action == "open" {
		kind = "welcome_open"
	}
	now := a.now()
	// Lock subscriptions before inserting their child rows, matching deletion
	// and session revocation. Host changes coalesce to one pending update/device.
	_, err := tx.ExecContext(ctx, `WITH recipients AS MATERIALIZED (
 SELECT s.id,s.version FROM notification_subscriptions s
 JOIN sessions session ON session.token_hash=s.session_hash AND session.guest_id=s.guest_id
 JOIN guests guest ON guest.id=s.guest_id
 WHERE guest.active=1 AND session.expires_at>$1
 ORDER BY s.id FOR KEY SHARE OF s
 ) INSERT INTO notification_outbox(subscription_id,subscription_version,revision,generation,unlocked_step,kind,next_attempt,expires_at)
 SELECT id,version,$2,$3,$4,$5,$1,$6 FROM recipients
 ON CONFLICT(subscription_id) DO UPDATE SET subscription_version=excluded.subscription_version,
 revision=excluded.revision,generation=excluded.generation,unlocked_step=excluded.unlocked_step,
 kind=excluded.kind,attempts=0,next_attempt=excluded.next_attempt,expires_at=excluded.expires_at`,
		now.Unix(), state.Revision+1, state.Generation, state.CurrentStep, kind, now.Add(notificationLifetime).Unix())
	return err
}

type pendingNotification struct {
	SubscriptionID      int64
	SubscriptionVersion int64
	Revision            int64
	Endpoint            string
	Keys                webpush.Keys
	Kind                string
	Locale              string
	Attempts            int
	ExpiresAt           int64
}

// The queue is owned by the same single-process advisory lock as media jobs.
// Rows stay pending while sending, so a restart retries them; the service worker
// replaces its fixed notification tag instead of accumulating duplicates.
func (a *App) notificationWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		processed, err := a.processNextNotification(ctx)
		if err != nil && ctx.Err() == nil {
			// External errors may contain subscription URLs. Only database failures
			// reach here, and the worker reports a fixed diagnostic as a precaution.
			a.reportWorkerError(errors.New("notification queue is unavailable"))
			return
		}
		if processed {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Both cleanup and delivery use these conditions, including fresh session and
// welcome progress checks. No authored content is copied into the outbox.
const eligibleNotificationSQL = `FROM notification_subscriptions s
 JOIN sessions session ON session.token_hash=s.session_hash AND session.guest_id=s.guest_id
 JOIN guests guest ON guest.id=s.guest_id
 JOIN welcome w ON w.id=1
 LEFT JOIN guest_welcome_progress p ON p.guest_id=s.guest_id AND p.generation=w.generation
 WHERE s.id=o.subscription_id AND s.version=o.subscription_version
 AND guest.active=1 AND session.expires_at>$1
 AND o.generation=w.generation AND o.expires_at>$1 AND o.attempts<5
 AND (guest.role='admin' OR ((p.guest_id IS NULL OR NOT p.completed)
 AND (o.kind='welcome_open' OR COALESCE(p.position,0)<o.unlocked_step)))`

func (a *App) processNextNotification(ctx context.Context) (bool, error) {
	query, cancelQuery := context.WithTimeout(ctx, workerQueryTimeout)
	now := a.now().Unix()
	_, err := a.db.ExecContext(query, "DELETE FROM notification_outbox o WHERE NOT EXISTS(SELECT 1 "+eligibleNotificationSQL+")", now)
	if err != nil {
		cancelQuery()
		return false, err
	}
	var pending pendingNotification
	err = a.db.QueryRowContext(query, `SELECT o.subscription_id,o.subscription_version,o.revision,
 s.endpoint,s.p256dh,s.auth,o.kind,s.locale,o.attempts,o.expires_at
 FROM notification_outbox o JOIN notification_subscriptions s ON s.id=o.subscription_id
 WHERE o.next_attempt<=$1 AND EXISTS(SELECT 1 `+eligibleNotificationSQL+`)
 ORDER BY o.next_attempt,o.subscription_id LIMIT 1`, now).Scan(
		&pending.SubscriptionID, &pending.SubscriptionVersion, &pending.Revision,
		&pending.Endpoint, &pending.Keys.P256dh, &pending.Keys.Auth,
		&pending.Kind, &pending.Locale, &pending.Attempts, &pending.ExpiresAt)
	cancelQuery()
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	status := a.sendNotification(ctx, pending)
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	update, cancelUpdate := context.WithTimeout(ctx, workerQueryTimeout)
	defer cancelUpdate()
	if status == http.StatusNotFound || status == http.StatusGone {
		_, err = a.db.ExecContext(update, "DELETE FROM notification_subscriptions WHERE id=$1 AND version=$2", pending.SubscriptionID, pending.SubscriptionVersion)
		return true, err
	}
	retry := status == 0 || status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
	delay := time.Duration(5*(1<<pending.Attempts)) * time.Second
	nextAttempt := a.now().Add(delay).Unix()
	if retry && pending.Attempts+1 < 5 && nextAttempt < pending.ExpiresAt {
		_, err = a.db.ExecContext(update, `UPDATE notification_outbox SET attempts=attempts+1,next_attempt=$4
 WHERE subscription_id=$1 AND subscription_version=$2 AND revision=$3`, pending.SubscriptionID, pending.SubscriptionVersion, pending.Revision, nextAttempt)
	} else {
		_, err = a.db.ExecContext(update, "DELETE FROM notification_outbox WHERE subscription_id=$1 AND subscription_version=$2 AND revision=$3", pending.SubscriptionID, pending.SubscriptionVersion, pending.Revision)
	}
	return true, err
}

func (a *App) sendNotification(ctx context.Context, pending pendingNotification) int {
	if !validNotificationEndpoint(pending.Endpoint) || pending.ExpiresAt <= a.now().Unix() {
		return http.StatusBadRequest
	}
	payload, err := json.Marshal(struct {
		Type   string `json:"type"`
		Locale string `json:"locale"`
	}{Type: pending.Kind, Locale: pending.Locale})
	if err != nil {
		return http.StatusBadRequest
	}
	send, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	response, err := webpush.SendNotificationWithContext(send, payload, &webpush.Subscription{
		Endpoint: pending.Endpoint, Keys: pending.Keys,
	}, &webpush.Options{
		HTTPClient: a.notificationClient, Subscriber: strings.TrimPrefix(a.config.VAPIDSubject, "mailto:"),
		VAPIDPublicKey: a.notificationKeys.Public, VAPIDPrivateKey: a.notificationKeys.Private,
		TTL:   min(int(notificationLifetime.Seconds()), max(0, int(pending.ExpiresAt-a.now().Unix()))),
		Topic: "birthday-welcome", Urgency: webpush.UrgencyNormal,
	})
	if response != nil && response.Body != nil {
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	}
	if err != nil {
		return 0
	}
	if response == nil {
		return 0
	}
	return response.StatusCode
}
