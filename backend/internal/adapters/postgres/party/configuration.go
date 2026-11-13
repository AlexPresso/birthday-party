package party

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"birthday-party/backend/internal/access"
	pgaccess "birthday-party/backend/internal/adapters/postgres/access"
	"birthday-party/backend/internal/party"
)

var _ party.ConfigurationRepository = (*Store)(nil)

// InitializeConfiguration imports environment defaults once, preserving later host edits.
func (s *Store) InitializeConfiguration(ctx context.Context, initial func() (party.Configuration, error)) error {
	var initialized bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM product_configuration WHERE id=1)").Scan(&initialized); err != nil {
		return err
	}
	if initialized {
		return nil
	}
	input, err := initial()
	if err != nil {
		return err
	}
	copy, err := json.Marshal(input.Invitation)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO product_configuration(id,age,invitation,image_size_mb,video_size_mb)
 VALUES(1,$1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`, input.Age, copy, input.ImageSizeMB, input.VideoSizeMB)
	return err
}

func (s *Store) Configuration(ctx context.Context) (party.Configuration, error) {
	var result party.Configuration
	var copy []byte
	err := s.db.QueryRowContext(ctx, "SELECT age,invitation,image_size_mb,video_size_mb FROM product_configuration WHERE id=1").Scan(&result.Age, &copy, &result.ImageSizeMB, &result.VideoSizeMB)
	if err != nil {
		return result, err
	}
	err = json.Unmarshal(copy, &result.Invitation)
	return result, err
}

func (s *Store) SaveConfiguration(ctx context.Context, actor party.ConfigurationActor, input party.Configuration) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	guest, session, err := pgaccess.LockGuestSession(ctx, tx, actor.GuestID, actor.SessionHash, pgaccess.GuestForShare)
	if errors.Is(err, sql.ErrNoRows) {
		return access.ErrExpired
	}
	if err != nil {
		return err
	}
	if err := access.Check(access.Snapshot{Guest: guest}, access.Request{Admin: true, Scope: access.Session}); err != nil {
		return err
	}
	var id int
	if err := tx.QueryRowContext(ctx, "SELECT id FROM product_configuration WHERE id=1 FOR UPDATE").Scan(&id); err != nil {
		return err
	}
	// Lock waits can outlast the session; sample time only after every lock is held.
	if !session.ValidAt(s.now()) {
		return access.ErrExpired
	}
	copy, err := json.Marshal(input.Invitation)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE product_configuration SET age=$1,invitation=$2,image_size_mb=$3,video_size_mb=$4 WHERE id=1", input.Age, copy, input.ImageSizeMB, input.VideoSizeMB); err != nil {
		return err
	}
	return tx.Commit()
}
