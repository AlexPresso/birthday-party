// Package access reads session and welcome permissions from one snapshot.
package access

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"birthday-party/backend/internal/access"
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
)

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }

var _ access.Repository = (*Store)(nil)

func (s *Store) Session(ctx context.Context, session string, now time.Time) (access.Snapshot, error) {
	var result access.Snapshot
	var avatarVersion int64
	guest := &result.Guest
	err := s.db.QueryRowContext(ctx, `SELECT g.id,g.name,g.role,g.active,`+pgwelcome.AccessSQL+`,
 CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END,
 COALESCE(`+pgwelcome.PositionSQL+` AND w.steps->(p.position-1)->'widgets' @> '[{"type":"profile_photo"}]'::jsonb,false),
 COALESCE(`+pgwelcome.PositionSQL+` AND w.steps->(p.position-1)->'widgets' @> '[{"type":"media_upload"}]'::jsonb,false)
 FROM sessions s JOIN guests g ON g.id=s.guest_id CROSS JOIN welcome w
 LEFT JOIN guest_welcome_progress p ON p.guest_id=g.id
 WHERE w.id=1 AND s.token_hash=$1 AND s.expires_at>$2 AND g.active=1`, session, now.Unix()).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active, &result.Open, &avatarVersion, &result.ProfileWidget, &result.MediaWidget)
	if errors.Is(err, sql.ErrNoRows) {
		return result, access.ErrExpired
	}
	if err != nil {
		return result, err
	}
	guest.AvatarURL = identity.AvatarURL(guest.ID, avatarVersion)
	return result, nil
}

func (s *Store) Realtime(ctx context.Context, session string, guestID int64, now time.Time) (int64, bool, error) {
	var expires int64
	var programme bool
	err := s.db.QueryRowContext(ctx, `SELECT s.expires_at,(g.role='admin' OR `+pgwelcome.AccessSQL+`)
 FROM sessions s JOIN guests g ON g.id=s.guest_id CROSS JOIN welcome w
 LEFT JOIN guest_welcome_progress p ON p.guest_id=g.id
 WHERE w.id=1 AND s.token_hash=$1 AND s.guest_id=$2 AND s.expires_at>$3 AND g.active=1`, session, guestID, now.Unix()).Scan(&expires, &programme)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, access.ErrExpired
	}
	return expires, programme, err
}
