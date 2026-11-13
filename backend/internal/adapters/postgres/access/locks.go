package access

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"birthday-party/backend/internal/identity"
)

// GuestLock selects how strongly a write transaction holds the acting guest.
// Either strength makes revocation wait for the transaction.
type GuestLock string

const (
	// GuestForUpdate also serializes writes to the guest's own records.
	GuestForUpdate GuestLock = "FOR UPDATE"
	// GuestForShare lets other transactions of the same guest proceed.
	GuestForShare GuestLock = "FOR SHARE"
)

// Session is a session row locked for the rest of a transaction.
type Session struct {
	found   bool
	expires time.Time
}

// ValidAt reports whether the session exists and is unexpired at now. Sample
// now after the last lock the transaction waits for: a wait can outlast the
// session, while logout and revocation are already excluded by the row lock.
func (s Session) ValidAt(now time.Time) bool { return s.found && s.expires.After(now) }

// LockSession share-locks the guest's session so logout and revocation wait
// for the transaction. A missing session is reported by ValidAt.
func LockSession(ctx context.Context, tx *sql.Tx, guestID int64, sessionHash string) (Session, error) {
	var session Session
	err := tx.QueryRowContext(ctx, "SELECT expires_at FROM sessions WHERE token_hash=$1 AND guest_id=$2 FOR SHARE", sessionHash, guestID).Scan(&session.expires)
	if errors.Is(err, sql.ErrNoRows) {
		return session, nil
	}
	session.found = err == nil
	return session, err
}

// LockGuestSession locks the acting guest and then their session, the order
// every write transaction follows. Callers check the returned guest before the
// session so a revoked guest is reported as such. It returns sql.ErrNoRows
// when the guest does not exist.
func LockGuestSession(ctx context.Context, tx *sql.Tx, guestID int64, sessionHash string, lock GuestLock) (identity.Guest, Session, error) {
	var guest identity.Guest
	err := tx.QueryRowContext(ctx, "SELECT id,name,role,active FROM guests WHERE id=$1 "+string(lock), guestID).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active)
	if err != nil {
		return guest, Session{}, err
	}
	session, err := LockSession(ctx, tx, guestID, sessionHash)
	return guest, session, err
}
