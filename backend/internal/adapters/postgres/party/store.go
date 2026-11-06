// Package party stores party details in PostgreSQL.
package party

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/party"
)

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func New(db *sql.DB, now func() time.Time) *Store { return &Store{db: db, now: now} }

var _ party.Repository = (*Store)(nil)

func (s *Store) Get(ctx context.Context) (party.Party, error) {
	var details party.Party
	err := s.db.QueryRowContext(ctx, "SELECT title,timezone,date,location FROM party WHERE id=1").Scan(&details.Title, &details.Timezone, &details.Date, &details.Location)
	return details, err
}

func (s *Store) Save(ctx context.Context, input party.Party) error {
	_, err := s.db.ExecContext(ctx, "UPDATE party SET title=$1,timezone=$2,date=$3,location=$4 WHERE id=1", input.Title, input.Timezone, input.Date, input.Location)
	return err
}
