package identity

import (
	"context"
	"database/sql"
	"errors"

	"birthday-party/backend/internal/identity"
)

func issueInvitation(ctx context.Context, tx *sql.Tx, id int64, credential identity.Credential) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM invitations WHERE guest_id=$1", id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO invitations(token_hash,guest_id,expires_at) VALUES($1,$2,$3)", credential.TokenHash, id, credential.ExpiresAt)
	return err
}

// EnsureAdminInvitation reuses an active administrator and replaces its invitation.
// A nil name selects the oldest administrator, creating the technical Admin if absent.
func (s *Store) EnsureAdminInvitation(ctx context.Context, name *string, issue func() (identity.Credential, error)) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return err
	}
	var id int64
	if name == nil {
		err = tx.QueryRowContext(ctx, "SELECT id FROM guests WHERE role='admin' AND active ORDER BY id LIMIT 1").Scan(&id)
	} else {
		err = tx.QueryRowContext(ctx, "SELECT id FROM guests WHERE name=$1 AND role='admin' AND active ORDER BY id LIMIT 1", *name).Scan(&id)
	}
	if errors.Is(err, sql.ErrNoRows) {
		newName := "Admin"
		if name != nil {
			newName = *name
		}
		err = tx.QueryRowContext(ctx, "INSERT INTO guests(name,role) VALUES($1,'admin') RETURNING id", newName).Scan(&id)
	}
	if err != nil {
		return err
	}
	credential, err := issue()
	if err != nil {
		return err
	}
	if err := issueInvitation(ctx, tx, id, credential); err != nil {
		return err
	}
	return tx.Commit()
}

// Invitation loads private state for service-side availability checks.
func (s *Store) Invitation(ctx context.Context, hash string) (identity.PendingInvitation, error) {
	var pending identity.PendingInvitation
	err := s.db.QueryRowContext(ctx, `SELECT g.id,g.name,g.role,g.active,i.expires_at,i.used_at IS NOT NULL FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE i.token_hash=$1`, hash).
		Scan(&pending.Guest.ID, &pending.Guest.Name, &pending.Guest.Role, &pending.Guest.Active, &pending.ExpiresAt, &pending.Used)
	if errors.Is(err, sql.ErrNoRows) {
		return identity.PendingInvitation{}, identity.ErrUnavailableInvitation
	}
	if err != nil {
		return identity.PendingInvitation{}, err
	}
	return pending, nil
}

// RenewInvitation reactivates the guest and replaces the invitation under one lock.
func (s *Store) RenewInvitation(ctx context.Context, id int64, issue func() (identity.Credential, error)) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "UPDATE guests SET active=TRUE WHERE id=$1", id)
	if err := changed(result, err); err != nil {
		return err
	}
	credential, err := issue()
	if err != nil {
		return err
	}
	if err := issueInvitation(ctx, tx, id, credential); err != nil {
		return err
	}
	return tx.Commit()
}
