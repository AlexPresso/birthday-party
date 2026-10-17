package media

import (
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/media"
	"context"
	"database/sql"
	"errors"
)

func (s *Store) authorizeUpload(ctx context.Context, tx *sql.Tx, guestID int64, destination *media.Destination) error {
	var active bool
	var role string
	if err := tx.QueryRowContext(ctx, "SELECT active,role FROM guests WHERE id=$1 FOR UPDATE", guestID).Scan(&active, &role); err != nil {
		return err
	}
	if !active {
		return &media.Error{Code: "access_revoked"}
	}
	var expires int64
	err := tx.QueryRowContext(ctx, "SELECT expires_at FROM sessions WHERE token_hash=$1 AND guest_id=$2 FOR SHARE", destination.SessionHash, guestID).Scan(&expires)
	// Guest/session locks may wait past expiry; evaluate the clock after acquiring them.
	if errors.Is(err, sql.ErrNoRows) || err == nil && expires <= s.now().Unix() {
		return &media.Error{Code: "session_expired"}
	}
	if err != nil {
		return err
	}
	// Lock order: quota (when accepting), guest, session, welcome, progress, category.
	view, err := pgwelcome.CurrentGuest(ctx, tx, guestID)
	if err != nil {
		return err
	}
	if err := media.AuthorizeDestination(role, view, destination); err != nil {
		return err
	}
	if destination.CategoryID != nil {
		var public bool
		err := tx.QueryRowContext(ctx, "SELECT is_public FROM media_categories WHERE id=$1 FOR SHARE", *destination.CategoryID).Scan(&public)
		if errors.Is(err, sql.ErrNoRows) {
			return &media.Error{Code: "media_category_not_found"}
		}
		if err != nil {
			return err
		}
		if !public && role != "admin" && destination.WelcomeRevision == nil {
			return &media.Error{Code: "media_category_not_found"}
		}
	}
	return nil
}

func (s *Store) Inspect(ctx context.Context, guestID int64, clientID string, destination *media.Destination) (*media.Upload, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := s.authorizeUpload(ctx, tx, guestID, destination); err != nil {
		return nil, err
	}
	job, err := scanUpload(tx.QueryRowContext(ctx, uploadSelect+` WHERE j.guest_id=$1 AND j.client_upload_id=$2`, guestID, clientID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := media.SameDestination(job, *destination); err != nil {
		return nil, err
	}
	return &job, nil
}
