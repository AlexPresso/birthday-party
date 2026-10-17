package identity

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"birthday-party/backend/internal/identity"
)

// ConsumeInvitation runs the service's grant decision under the guest row lock,
// then consumes the invitation and persists the session in the same transaction.
func (s *Store) ConsumeInvitation(ctx context.Context, hash string, authorize func(identity.PendingInvitation) (identity.SessionGrant, error)) (identity.Guest, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return identity.Guest{}, err
	}
	defer tx.Rollback()
	var pending identity.PendingInvitation
	var version, expires int64
	// Lock the guest before the invitation, matching renewal and revocation.
	err = tx.QueryRowContext(ctx, `SELECT g.id,g.name,g.role,g.active,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END,i.expires_at,i.used_at IS NOT NULL FROM invitations i JOIN guests g ON g.id=i.guest_id WHERE i.token_hash=$1 FOR UPDATE OF g`, hash).
		Scan(&pending.Guest.ID, &pending.Guest.Name, &pending.Guest.Role, &pending.Guest.Active, &version, &expires, &pending.Used)
	if errors.Is(err, sql.ErrNoRows) {
		return identity.Guest{}, identity.ErrUnavailableInvitation
	}
	if err != nil {
		return identity.Guest{}, err
	}
	pending.ExpiresAt = time.Unix(expires, 0)
	pending.Guest.AvatarURL = identity.AvatarURL(pending.Guest.ID, version)
	grant, err := authorize(pending)
	if err != nil {
		return identity.Guest{}, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE invitations SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL AND expires_at>$3", grant.CreatedAt.Unix(), hash, grant.CreatedAt.Unix())
	if err != nil {
		return identity.Guest{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return identity.Guest{}, err
	}
	if count != 1 {
		return identity.Guest{}, identity.ErrUsedInvitation
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<=$1", grant.CreatedAt.Unix()); err != nil {
		return identity.Guest{}, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE guest_id=$1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE guest_id=$2 ORDER BY created_at DESC,token_hash DESC LIMIT $3)", pending.Guest.ID, pending.Guest.ID, grant.SessionLimit-1); err != nil {
		return identity.Guest{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,guest_id,created_at,expires_at) VALUES($1,$2,$3,$4)", grant.Credential.TokenHash, pending.Guest.ID, grant.CreatedAt.Unix(), grant.Credential.ExpiresAt.Unix()); err != nil {
		return identity.Guest{}, err
	}
	if err := tx.Commit(); err != nil {
		return identity.Guest{}, err
	}
	return pending.Guest, nil
}

// Logout removes a session and its dependent notification subscriptions.
func (s *Store) Logout(ctx context.Context, hash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=$1", hash)
	return err
}
