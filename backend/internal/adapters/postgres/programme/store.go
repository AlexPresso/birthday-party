// Package programme implements scheduled event persistence in PostgreSQL.
package programme

import (
	"context"
	"database/sql"

	"birthday-party/backend/internal/programme"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct{ db *sql.DB }

var _ programme.Repository = (*Store)(nil)

// New uses an initialized database without starting background work.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns bounded authored events for the service's audience and timing rules.
func (s *Store) List(ctx context.Context, limit int) ([]programme.Event, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,title,description,teaser,starts_at,unlock_at FROM events LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []programme.Event{}
	for rows.Next() {
		var event programme.Event
		if err := rows.Scan(&event.ID, &event.Title, &event.Description, &event.Teaser, &event.StartsAt, &event.UnlockAt); err != nil {
			return nil, err
		}
		items = append(items, event)
	}
	return items, rows.Err()
}

// UnlockTimes loads only the bounded timestamps needed by the scheduler.
func (s *Store) UnlockTimes(ctx context.Context, limit int) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT unlock_at FROM events WHERE unlock_at IS NOT NULL LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	times := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		times = append(times, value)
	}
	return times, rows.Err()
}

// Create checks the capacity and inserts an event under the same table lock.
func (s *Store) Create(ctx context.Context, input programme.Input, limit int) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE events IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return 0, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM events").Scan(&count); err != nil {
		return 0, err
	}
	if count >= limit {
		return 0, programme.ErrLimitReached
	}
	var id int64
	err = tx.QueryRowContext(ctx, "INSERT INTO events(title,description,teaser,starts_at,unlock_at) VALUES($1,$2,$3,$4,$5) RETURNING id", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

// Update replaces the authored fields of an existing event.
func (s *Store) Update(ctx context.Context, id int64, input programme.Input) error {
	result, err := s.db.ExecContext(ctx, "UPDATE events SET title=$1,description=$2,teaser=$3,starts_at=$4,unlock_at=$5 WHERE id=$6", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt, id)
	return changed(result, err)
}

// Delete removes an existing event.
func (s *Store) Delete(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM events WHERE id=$1", id)
	return changed(result, err)
}

func changed(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return programme.ErrNotFound
	}
	return nil
}
