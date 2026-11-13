// Package party stores party details in PostgreSQL.
package party

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/party"
	"birthday-party/backend/internal/timestamp"
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

var _ party.Repository = (*Store)(nil)

func (s *Store) Get(ctx context.Context) (party.Party, error) {
	var details party.Party
	var date *time.Time
	err := s.db.QueryRowContext(ctx, "SELECT title,timezone,date,location FROM party WHERE id=1").Scan(&details.Title, &details.Timezone, &date, &details.Location)
	details.Date = timestamp.FormatOptional(date)
	return details, err
}

// Save stores a normalized party; its date is already a valid UTC instant.
func (s *Store) Save(ctx context.Context, input party.Party) error {
	_, err := s.db.ExecContext(ctx, "UPDATE party SET title=$1,timezone=$2,date=$3::timestamptz,location=$4 WHERE id=1", input.Title, input.Timezone, input.Date, input.Location)
	return err
}
