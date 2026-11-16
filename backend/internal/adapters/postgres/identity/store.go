// Package identity implements atomic identity workflows in PostgreSQL.
package identity

import (
	"context"
	"database/sql"
	"errors"

	"birthday-party/backend/internal/identity"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct{ db *sql.DB }

var _ identity.Repository = (*Store)(nil)

// New uses an initialized database without starting background work.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns the bounded list of guest identities.
func (s *Store) List(ctx context.Context, limit int) ([]identity.Guest, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,role,active,CASE WHEN avatar_jpeg IS NOT NULL THEN avatar_version ELSE 0 END,phone,joined_at IS NOT NULL FROM guests ORDER BY active DESC,name,id LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []identity.Guest{}
	for rows.Next() {
		var guest identity.Guest
		var version int64
		var joined bool
		if err := rows.Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active, &version, &guest.Phone, &joined); err != nil {
			return nil, err
		}
		guest.AvatarURL = identity.AvatarURL(guest.ID, version)
		guest.Joined = &joined
		items = append(items, guest)
	}
	return items, rows.Err()
}

// CreateGuest checks capacity and creates the guest and invitation atomically.
func (s *Store) CreateGuest(ctx context.Context, name string, phone *string, issue func() (identity.Credential, error), limit int) (identity.Guest, error) {
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
	guest := identity.Guest{Name: name, Role: identity.RoleGuest, Active: true, Phone: phone}
	if err := tx.QueryRowContext(ctx, "INSERT INTO guests(name,role,phone) VALUES($1,'guest',$2) RETURNING id", name, phone).Scan(&guest.ID); err != nil {
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

// UpdateGuest locks the guest, saves the name and number, and replaces the
// invitation of an active guest whose number changed.
func (s *Store) UpdateGuest(ctx context.Context, id int64, name string, phone *string, issue func() (identity.Credential, error)) (identity.Guest, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return identity.Guest{}, err
	}
	defer tx.Rollback()
	var previous sql.NullString
	err = tx.QueryRowContext(ctx, "SELECT phone FROM guests WHERE id=$1 FOR UPDATE", id).Scan(&previous)
	if errors.Is(err, sql.ErrNoRows) {
		return identity.Guest{}, identity.ErrNotFound
	}
	if err != nil {
		return identity.Guest{}, err
	}
	guest := identity.Guest{ID: id, Phone: phone}
	var version int64
	if err := tx.QueryRowContext(ctx, `UPDATE guests SET name=$1,phone=$2 WHERE id=$3
 RETURNING name,role,active,CASE WHEN avatar_jpeg IS NOT NULL THEN avatar_version ELSE 0 END`, name, phone, id).
		Scan(&guest.Name, &guest.Role, &guest.Active, &version); err != nil {
		return identity.Guest{}, err
	}
	guest.AvatarURL = identity.AvatarURL(id, version)
	if guest.Active && (previous.Valid != (phone != nil) || (phone != nil && previous.String != *phone)) {
		credential, err := issue()
		if err != nil {
			return identity.Guest{}, err
		}
		if err := issueInvitation(ctx, tx, id, credential); err != nil {
			return identity.Guest{}, err
		}
	}
	return guest, tx.Commit()
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

// Delete removes a revoked guest. Their messages, media and questions stay
// without an author; their sessions, profile, progress, votes, upvotes and
// werewolf seats go with them.
func (s *Store) Delete(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// The guest lock comes first, as in every other workflow; a revoked guest
	// can no longer start an upload, a vote or a game command.
	var active bool
	err = tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1 FOR UPDATE", id).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) {
		return identity.ErrNotFound
	}
	if err != nil {
		return err
	}
	if active {
		return identity.ErrGuestActive
	}
	// Publishing locks the guest too, so no pending job can finish meanwhile.
	var uploads bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM upload_jobs WHERE guest_id=$1 AND status IN ('queued','processing'))", id).Scan(&uploads); err != nil {
		return err
	}
	if uploads {
		return identity.ErrGuestUploads
	}
	// Lock the guest's games: a running game keeps its players and game master.
	var running bool
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(BOOL_OR(status='running'),FALSE) FROM (
 SELECT g.status FROM programme_werewolf_games g
 WHERE g.game_master_id=$1 OR EXISTS (SELECT 1 FROM programme_werewolf_players p WHERE p.activity_id=g.activity_id AND p.guest_id=$1)
 FOR UPDATE OF g) games`, id).Scan(&running); err != nil {
		return err
	}
	if running {
		return identity.ErrGuestInGame
	}
	for _, statement := range []string{
		"UPDATE entries SET guest_id=NULL,anonymous=TRUE WHERE guest_id=$1",
		"UPDATE photos SET guest_id=NULL WHERE guest_id=$1",
		"UPDATE programme_questions SET guest_id=NULL WHERE guest_id=$1",
		"UPDATE programme_werewolf_games SET game_master_id=NULL WHERE game_master_id=$1",
		// Messages follow their seat.
		"DELETE FROM programme_werewolf_players WHERE guest_id=$1",
		"DELETE FROM programme_question_upvotes WHERE guest_id=$1",
		"DELETE FROM programme_ballots WHERE guest_id=$1",
		// The ballots for the guest's option follow it.
		"DELETE FROM programme_vote_options WHERE guest_id=$1",
		"DELETE FROM upload_jobs WHERE guest_id=$1",
		"DELETE FROM notification_subscriptions WHERE guest_id=$1",
		"DELETE FROM sessions WHERE guest_id=$1",
		"DELETE FROM invitations WHERE guest_id=$1",
		"DELETE FROM guest_welcome_progress WHERE guest_id=$1",
		"DELETE FROM guests WHERE id=$1",
	} {
		if _, err := tx.ExecContext(ctx, statement, id); err != nil {
			return err
		}
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
