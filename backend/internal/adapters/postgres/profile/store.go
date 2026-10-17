// Package profile persists versioned avatars with atomic authorization checks.
package profile

import (
	"context"
	"database/sql"
	"errors"
	"time"

	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/profile"
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

var _ profile.Repository = (*Store)(nil)

func (s *Store) Save(ctx context.Context, guestID int64, sessionHash string, data []byte) (identity.Guest, error) {
	var guest identity.Guest
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return guest, err
	}
	defer tx.Rollback()
	// Follow media acceptance's guest-then-welcome lock order. Recheck the
	// session too, because logout, revocation or closing access can finish
	// while an image is being received and decoded.
	err = tx.QueryRowContext(ctx, "SELECT id,name,role,active FROM guests WHERE id=$1 FOR UPDATE", guestID).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active)
	if err != nil {
		return guest, err
	}
	if !guest.Active {
		return guest, profile.ErrRevoked
	}
	var sessionGuestID int64
	// A request may have waited on the guest lock long enough for its session to
	// expire. Evaluate the clock only after acquiring that lock.
	err = tx.QueryRowContext(ctx, "SELECT guest_id FROM sessions WHERE token_hash=$1 AND guest_id=$2 AND expires_at>$3 FOR SHARE", sessionHash, guestID, s.now().Unix()).Scan(&sessionGuestID)
	if errors.Is(err, sql.ErrNoRows) {
		return guest, profile.ErrExpired
	}
	if err != nil {
		return guest, err
	}
	view, err := pgwelcome.CurrentGuest(ctx, tx, guestID)
	if err != nil {
		return guest, err
	}
	if err := profile.CanEdit(guest, view); err != nil {
		return guest, err
	}
	var version int64
	// At most 128 KiB per guest keeps atomic PostgreSQL storage small and avoids
	// orphaned files on replacement, rollback or process interruption.
	err = tx.QueryRowContext(ctx, "UPDATE guests SET avatar_jpeg=$1,avatar_version=avatar_version+1 WHERE id=$2 RETURNING avatar_version", data, guestID).Scan(&version)
	if err != nil {
		return guest, err
	}
	if data != nil {
		guest.AvatarURL = identity.AvatarURL(guest.ID, version)
	}
	return guest, tx.Commit()
}

func (s *Store) Avatar(ctx context.Context, id, version int64) ([]byte, error) {
	var data []byte
	err := s.db.QueryRowContext(ctx, "SELECT avatar_jpeg FROM guests WHERE id=$1 AND avatar_version=$2 AND avatar_jpeg IS NOT NULL", id, version).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, profile.ErrNotFound
	}
	return data, err
}
