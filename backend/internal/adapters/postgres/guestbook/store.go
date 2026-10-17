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

// New uses an initialized database without starting background work.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns a bounded page of private records for service-side attribution.
func (s *Store) List(ctx context.Context, before int64, limit int) ([]guestbook.Record, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id,g.id,g.name,e.anonymous,e.body,e.created_at,CASE WHEN e.anonymous=0 AND g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END FROM entries e JOIN guests g ON e.guest_id=g.id WHERE ($1::bigint=0 OR e.id<$2) ORDER BY e.id DESC LIMIT $3`, before, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []guestbook.Record{}
	for rows.Next() {
		var record guestbook.Record
		var version int64
		if err := rows.Scan(&record.ID, &record.Author.ID, &record.Author.Name, &record.Anonymous, &record.Body, &record.CreatedAt, &version); err != nil {
			return nil, err
		}
		record.Author.AvatarURL = identity.AvatarURL(record.Author.ID, version)
		items = append(items, record)
	}
	return items, rows.Err()
}

// Create retains the owner even when the entry is anonymous.
func (s *Store) Create(ctx context.Context, record guestbook.Record) (int64, error) {
	flag := 0
	if record.Anonymous {
		flag = 1
	}
	var id int64
	err := s.db.QueryRowContext(ctx, "INSERT INTO entries(guest_id,anonymous,body,created_at) VALUES($1,$2,$3,$4) RETURNING id", record.Author.ID, flag, record.Body, record.CreatedAt).Scan(&id)
	return id, err
}

// Owner returns the immutable owner used by the service's deletion policy.
func (s *Store) Owner(ctx context.Context, id int64) (int64, error) {
	var owner int64
	err := s.db.QueryRowContext(ctx, "SELECT guest_id FROM entries WHERE id=$1", id).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, guestbook.ErrNotFound
	}
	return owner, err
}

// Delete reports whether this call removed an entry.
func (s *Store) Delete(ctx context.Context, id int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM entries WHERE id=$1", id)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count != 0, err
}
