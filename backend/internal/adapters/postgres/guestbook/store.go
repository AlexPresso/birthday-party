// Package guestbook implements guestbook persistence in PostgreSQL.
package guestbook

import (
	"context"
	"database/sql"
	"errors"

	"birthday-party/backend/internal/guestbook"
	"birthday-party/backend/internal/identity"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct{ db *sql.DB }

var _ guestbook.Repository = (*Store)(nil)

// New uses the application's initialized database.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns a bounded page of private records for service-side attribution.
func (s *Store) List(ctx context.Context, beforeID int64, limit int) ([]guestbook.Record, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			e.id,
			g.id,
			g.name,
			e.anonymous,
			e.body,
			e.created_at,
			CASE
				WHEN NOT e.anonymous AND g.avatar_jpeg IS NOT NULL THEN g.avatar_version
				ELSE 0
			END
		FROM entries e
		JOIN guests g ON e.guest_id=g.id
		WHERE ($1::bigint=0 OR e.id<$2)
		ORDER BY e.id DESC
		LIMIT $3`, beforeID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []guestbook.Record{}
	for rows.Next() {
		var record guestbook.Record
		var avatarVersion int64
		if err := rows.Scan(
			&record.ID,
			&record.Author.ID,
			&record.Author.Name,
			&record.Anonymous,
			&record.Body,
			&record.CreatedAt,
			&avatarVersion,
		); err != nil {
			return nil, err
		}
		record.Author.AvatarURL = identity.AvatarURL(record.Author.ID, avatarVersion)
		items = append(items, record)
	}
	return items, rows.Err()
}

// Create retains the owner even when the entry is anonymous.
func (s *Store) Create(ctx context.Context, record guestbook.Record) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO entries(guest_id,anonymous,body,created_at)
		VALUES($1,$2,$3,$4)
		RETURNING id`, record.Author.ID, record.Anonymous, record.Body, record.CreatedAt).Scan(&id)
	return id, err
}

// Owner returns the immutable owner used by the service's deletion policy.
func (s *Store) Owner(ctx context.Context, entryID int64) (int64, error) {
	var ownerID int64
	err := s.db.QueryRowContext(ctx, "SELECT guest_id FROM entries WHERE id=$1", entryID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, guestbook.ErrNotFound
	}
	return ownerID, err
}

// Delete reports whether this call removed an entry.
func (s *Store) Delete(ctx context.Context, entryID int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM entries WHERE id=$1", entryID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count != 0, err
}
