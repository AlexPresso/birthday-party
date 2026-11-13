// Package information stores the information page in PostgreSQL.
package information

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"birthday-party/backend/internal/information"
)

type Store struct{ db *sql.DB }

func New(db *sql.DB) *Store { return &Store{db: db} }

var _ information.Repository = (*Store)(nil)

func (s *Store) Get(ctx context.Context) (information.Page, error) {
	var page information.Page
	var tabs []byte
	err := s.db.QueryRowContext(ctx, "SELECT enabled,revision,tabs FROM information WHERE id=1").Scan(&page.Enabled, &page.Revision, &tabs)
	if err != nil {
		return page, err
	}
	return page, json.Unmarshal(tabs, &page.Tabs)
}

// Save compares and advances the revision in one statement, so two hosts
// editing at once cannot overwrite each other.
func (s *Store) Save(ctx context.Context, revision int64, page information.Page) (information.Page, error) {
	tabs, err := json.Marshal(page.Tabs)
	if err != nil {
		return page, err
	}
	err = s.db.QueryRowContext(ctx, "UPDATE information SET enabled=$1,tabs=$2,revision=revision+1 WHERE id=1 AND revision=$3 RETURNING revision", page.Enabled, tabs, revision).Scan(&page.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return page, information.ErrConflict
	}
	return page, err
}
