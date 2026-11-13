package media

import (
	"context"
	"database/sql"
	"errors"

	pgaccess "birthday-party/backend/internal/adapters/postgres/access"
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/media"
)

func (s *Store) authorizeUpload(ctx context.Context, tx *sql.Tx, guestID int64, destination *media.Destination) error {
	// Lock order: quota (when accepting), guest, session, welcome, progress, category.
	guest, session, err := pgaccess.LockGuestSession(ctx, tx, guestID, destination.SessionHash, pgaccess.GuestForUpdate)
	if err != nil {
		return err
	}
	if !guest.Active {
		return &media.Error{Code: "access_revoked"}
	}
	// Guest/session locks may wait past expiry; evaluate the clock after acquiring them.
	if !session.ValidAt(s.now()) {
		return &media.Error{Code: "session_expired"}
	}
	view, err := pgwelcome.CurrentGuest(ctx, tx, guestID)
	if err != nil {
		return err
	}
	if err := media.AuthorizeDestination(guest, view, destination); err != nil {
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
		if !public && !guest.IsAdmin() && destination.WelcomeRevision == nil {
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
