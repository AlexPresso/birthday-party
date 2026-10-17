// Package notifications persists subscriptions and the durable Web Push outbox.
package notifications

import (
	"context"
	"database/sql"
	"errors"
	"time"

	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/notifications"
	"birthday-party/backend/internal/welcome"
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

var _ notifications.Repository = (*Store)(nil)

func (s *Store) LoadKeys(ctx context.Context, generate func() (notifications.SigningKeys, error)) (notifications.SigningKeys, error) {
	var keys notifications.SigningKeys
	err := s.db.QueryRowContext(ctx, "SELECT public_key,private_key FROM notification_keys WHERE id=1").Scan(&keys.Public, &keys.Private)
	if !errors.Is(err, sql.ErrNoRows) {
		return keys, err
	}
	keys, err = generate()
	if err != nil {
		return keys, err
	}
	if _, err = s.db.ExecContext(ctx, "INSERT INTO notification_keys(id,public_key,private_key) VALUES(1,$1,$2) ON CONFLICT(id) DO NOTHING", keys.Public, keys.Private); err != nil {
		return keys, err
	}
	err = s.db.QueryRowContext(ctx, "SELECT public_key,private_key FROM notification_keys WHERE id=1").Scan(&keys.Public, &keys.Private)
	return keys, err
}

func (s *Store) Status(ctx context.Context, guestID int64, sessionHash, endpointHash string) (bool, error) {
	var subscribed bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM notification_subscriptions WHERE endpoint_hash=$1 AND guest_id=$2 AND session_hash=$3)", endpointHash, guestID, sessionHash).Scan(&subscribed)
	return subscribed, err
}

func (s *Store) Delete(ctx context.Context, guestID int64, sessionHash, endpointHash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM notification_subscriptions WHERE endpoint_hash=$1 AND guest_id=$2 AND session_hash=$3", endpointHash, guestID, sessionHash)
	return err
}

func (s *Store) Save(ctx context.Context, guest identity.Guest, sessionHash string, input notifications.Subscription) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var access notifications.RegistrationAccess
	if err = tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&access.Active); err != nil {
		return err
	}
	if !access.Active {
		return &notifications.Error{Code: "access_revoked"}
	}
	var sessionGuestID int64
	// Evaluate expiry after any wait for the guest lock, before accepting a session.
	err = tx.QueryRowContext(ctx, "SELECT guest_id FROM sessions WHERE token_hash=$1 AND guest_id=$2 AND expires_at>$3 FOR SHARE", sessionHash, guest.ID, s.now().Unix()).Scan(&sessionGuestID)
	if errors.Is(err, sql.ErrNoRows) {
		return &notifications.Error{Code: "session_expired"}
	}
	if err != nil {
		return err
	}
	access.SessionValid = true
	view, err := pgwelcome.CurrentGuest(ctx, tx, guest.ID)
	if err != nil {
		return err
	}
	access.Open, access.Admin = view.Open, guest.Role == "admin"
	if view.Step != nil {
		for _, widget := range view.Step.Widgets {
			access.NotificationWidget = access.NotificationWidget || widget.Type == "enable_notifications"
		}
	}
	// Authorize before inspecting quotas, preserving error priority and lock order.
	if err := notifications.AuthorizeRegistration(access); err != nil {
		return err
	}
	endpointHash := identity.HashToken(input.Endpoint)
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM notification_subscriptions WHERE guest_id=$1 AND endpoint_hash<>$2", guest.ID, endpointHash).Scan(&access.OtherSubscriptions); err != nil {
		return err
	}
	if err := notifications.AuthorizeRegistration(access); err != nil {
		return err
	}
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO notification_subscriptions(endpoint_hash,endpoint,p256dh,auth,guest_id,session_hash,locale)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(endpoint_hash) DO UPDATE
 SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,
 guest_id=excluded.guest_id,session_hash=excluded.session_hash,locale=excluded.locale,
 version=notification_subscriptions.version+1 RETURNING id`, endpointHash, input.Endpoint, input.Keys.P256dh, input.Keys.Auth, guest.ID, sessionHash, input.Locale).Scan(&id)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM notification_outbox WHERE subscription_id=$1", id); err != nil {
		return err
	}
	return tx.Commit()
}

// EnqueueWelcome participates in the host's existing transaction. It never commits.
func (s *Store) EnqueueWelcome(ctx context.Context, tx *sql.Tx, state welcome.State, action string) error {
	if action == "start" {
		_, err := tx.ExecContext(ctx, "DELETE FROM notification_outbox")
		return err
	}
	kind := "welcome_step"
	if action == "open" {
		kind = "welcome_open"
	}
	now := s.now()
	// Lock subscriptions before child rows, matching deletion and revocation.
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
		now.Unix(), state.Revision+1, state.Generation, state.CurrentStep, kind, now.Add(notifications.Lifetime).Unix())
	return err
}

const eligibleSQL = `FROM notification_subscriptions s
 JOIN sessions session ON session.token_hash=s.session_hash AND session.guest_id=s.guest_id
 JOIN guests guest ON guest.id=s.guest_id
 JOIN welcome w ON w.id=1
 LEFT JOIN guest_welcome_progress p ON p.guest_id=s.guest_id AND p.generation=w.generation
 WHERE s.id=o.subscription_id AND s.version=o.subscription_version
 AND guest.active=1 AND session.expires_at>$1
 AND o.generation=w.generation AND o.expires_at>$1 AND o.attempts<5
 AND (guest.role='admin' OR ((p.guest_id IS NULL OR NOT p.completed)
 AND (o.kind='welcome_open' OR COALESCE(p.position,0)<o.unlocked_step)))`

func (s *Store) Next(ctx context.Context, now time.Time) (notifications.Pending, bool, error) {
	var pending notifications.Pending
	if _, err := s.db.ExecContext(ctx, "DELETE FROM notification_outbox o WHERE NOT EXISTS(SELECT 1 "+eligibleSQL+")", now.Unix()); err != nil {
		return pending, false, err
	}
	err := s.db.QueryRowContext(ctx, `SELECT o.subscription_id,o.subscription_version,o.revision,
 s.endpoint,s.p256dh,s.auth,o.kind,s.locale,o.attempts,o.expires_at
 FROM notification_outbox o JOIN notification_subscriptions s ON s.id=o.subscription_id
 WHERE o.next_attempt<=$1 AND EXISTS(SELECT 1 `+eligibleSQL+`)
 ORDER BY o.next_attempt,o.subscription_id LIMIT 1`, now.Unix()).Scan(
		&pending.SubscriptionID, &pending.SubscriptionVersion, &pending.Revision,
		&pending.Endpoint, &pending.Keys.P256dh, &pending.Keys.Auth,
		&pending.Kind, &pending.Locale, &pending.Attempts, &pending.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return pending, false, nil
	}
	return pending, err == nil, err
}

func (s *Store) Complete(ctx context.Context, pending notifications.Pending, result notifications.Completion) error {
	var err error
	switch result.Delivery {
	case notifications.RemoveSubscription:
		_, err = s.db.ExecContext(ctx, "DELETE FROM notification_subscriptions WHERE id=$1 AND version=$2", pending.SubscriptionID, pending.SubscriptionVersion)
	case notifications.RetryDelivery:
		_, err = s.db.ExecContext(ctx, `UPDATE notification_outbox SET attempts=attempts+1,next_attempt=$4
 WHERE subscription_id=$1 AND subscription_version=$2 AND revision=$3`, pending.SubscriptionID, pending.SubscriptionVersion, pending.Revision, result.NextAttempt)
	default:
		_, err = s.db.ExecContext(ctx, "DELETE FROM notification_outbox WHERE subscription_id=$1 AND subscription_version=$2 AND revision=$3", pending.SubscriptionID, pending.SubscriptionVersion, pending.Revision)
	}
	return err
}
