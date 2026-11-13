// Package identity implements atomic identity workflows in PostgreSQL.
package identity

import (
	"context"
	"database/sql"

	"birthday-party/backend/internal/identity"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct{ db *sql.DB }

var _ identity.Repository = (*Store)(nil)

// New uses an initialized database without starting background work.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns the bounded list of guest identities.
func (s *Store) List(ctx context.Context, limit int) ([]identity.Guest, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,role,active,CASE WHEN avatar_jpeg IS NOT NULL THEN avatar_version ELSE 0 END FROM guests ORDER BY active DESC,name,id LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []identity.Guest{}
	for rows.Next() {
		var guest identity.Guest
		var version int64
		if err := rows.Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active, &version); err != nil {
			return nil, err
		}
		guest.AvatarURL = identity.AvatarURL(guest.ID, version)
		items = append(items, guest)
	}
	return items, rows.Err()
}

// CreateGuest checks capacity and creates the guest and invitation atomically.
func (s *Store) CreateGuest(ctx context.Context, name string, issue func() (identity.Credential, error), limit int) (identity.Guest, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return identity.Guest{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return identity.Guest{}, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM guests").Scan(&count); err != nil {
		return identity.Guest{}, err
	}
	if count >= limit {
		return identity.Guest{}, identity.ErrLimitReached
	}
	guest := identity.Guest{Name: name, Role: identity.RoleGuest, Active: true}
	if err := tx.QueryRowContext(ctx, "INSERT INTO guests(name,role) VALUES($1,'guest') RETURNING id", name).Scan(&guest.ID); err != nil {
		return identity.Guest{}, err
	}
	credential, err := issue()
	if err != nil {
		return identity.Guest{}, err
	}
	if err := issueInvitation(ctx, tx, guest.ID, credential); err != nil {
		return identity.Guest{}, err
	}
	if err := tx.Commit(); err != nil {
		return identity.Guest{}, err
	}
	return guest, nil
}

// Revoke takes the guest row lock before removing sessions and invitations.
func (s *Store) Revoke(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "UPDATE guests SET active=FALSE WHERE id=$1", id)
	if err := changed(result, err); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE guest_id=$1", id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM invitations WHERE guest_id=$1", id); err != nil {
		return err
	}
	return tx.Commit()
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
		return identity.ErrNotFound
	}
	return nil
}
