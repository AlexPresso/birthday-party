// Package programme implements scheduled event persistence in PostgreSQL.
package programme

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/programme"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

var _ programme.Repository = (*Store)(nil)

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

func (s *Store) List(ctx context.Context, limit int, guestID int64, admin bool, now time.Time) ([]programme.Event, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	items, err := readEvents(ctx, tx, 0, limit, guestID, admin, now)
	if err != nil {
		return nil, err
	}
	return items, tx.Commit()
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

// Create commits the event, its settings and candidates together.
func (s *Store) Create(ctx context.Context, actor programme.Actor, input programme.Input, limit int) (programme.Event, error) {
	tx, err := s.begin(ctx, actor, 0, true, inputCandidates(input))
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE events IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return programme.Event{}, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM events").Scan(&count); err != nil {
		return programme.Event{}, err
	}
	if count >= limit {
		return programme.Event{}, programme.ErrLimitReached
	}
	var id int64
	err = tx.QueryRowContext(ctx, "INSERT INTO events(title,description,teaser,starts_at,unlock_at) VALUES($1,$2,$3,$4,$5) RETURNING id", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt).Scan(&id)
	if err != nil {
		return programme.Event{}, err
	}
	if input.Vote != nil {
		if err := createVote(ctx, tx, id, *input.Vote); err != nil {
			return programme.Event{}, err
		}
	}
	if input.Type == "questions" {
		_, err := tx.ExecContext(ctx, `WITH activity AS (
 INSERT INTO programme_activities(event_id,position,type) VALUES($1,0,'questions') RETURNING id)
 INSERT INTO programme_question_rounds(activity_id) SELECT id FROM activity`, id)
		if err != nil {
			return programme.Event{}, err
		}
	}
	return s.finish(ctx, tx, actor, id, true)
}

func (s *Store) Update(ctx context.Context, actor programme.Actor, id int64, input programme.Input) (programme.Event, error) {
	tx, err := s.begin(ctx, actor, id, true, inputCandidates(input))
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	event, err := readEvent(ctx, tx, id, actor.GuestID, true, s.now())
	if err != nil {
		return programme.Event{}, err
	}
	if err := event.CheckEdit(input); err != nil {
		return programme.Event{}, err
	}
	if input.Vote != nil {
		if err := updateVote(ctx, tx, event, *input.Vote); err != nil {
			return programme.Event{}, err
		}
	}
	_, err = tx.ExecContext(ctx, "UPDATE events SET title=$1,description=$2,teaser=$3,starts_at=$4,unlock_at=$5 WHERE id=$6", input.Title, input.Description, input.Teaser, input.StartsAt, input.UnlockAt, id)
	if err != nil {
		return programme.Event{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_activities SET revision=revision+1 WHERE event_id=$1", id); err != nil {
		return programme.Event{}, err
	}
	return s.finish(ctx, tx, actor, id, true)
}

func inputCandidates(input programme.Input) []int64 {
	if input.Vote == nil {
		return nil
	}
	return input.Vote.CandidateIDs
}

func (s *Store) Delete(ctx context.Context, actor programme.Actor, id int64) error {
	tx, err := s.begin(ctx, actor, id, true, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "DELETE FROM events WHERE id=$1", id); err != nil {
		return err
	}
	if err := s.checkExpiry(ctx, tx, actor); err != nil {
		return err
	}
	return tx.Commit()
}
