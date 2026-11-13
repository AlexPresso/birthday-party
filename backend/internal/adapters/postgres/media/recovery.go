package media

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"

	"birthday-party/backend/internal/media"
)

func (s *Store) AcquireWorkers(ctx context.Context) (*sql.Conn, error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	var locked bool
	if err = conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock(hashtext(current_schema()),73002)").Scan(&locked); err != nil {
		return nil, errors.Join(err, ReleaseWorkerConnection(conn))
	}
	if !locked {
		_ = conn.Close()
		return nil, errors.New("another media worker process is already running")
	}
	return conn, nil
}

func ReleaseWorkerConnection(conn *sql.Conn) error {
	ctx, cancel := context.WithTimeout(context.Background(), media.QueryTimeout)
	defer cancel()
	_, unlockErr := conn.ExecContext(ctx, "SELECT pg_advisory_unlock(hashtext(current_schema()),73002)")
	if unlockErr != nil {
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
	closeErr := conn.Close()
	if errors.Is(closeErr, sql.ErrConnDone) {
		closeErr = nil
	}
	if unlockErr != nil {
		unlockErr = fmt.Errorf("release media worker lock: %w", unlockErr)
	}
	return errors.Join(unlockErr, closeErr)
}

// Recover keeps the quota lock until file references have been reconciled.
// The file adapter receives only an inventory, never a transaction or connection.
func (s *Store) Recover(ctx context.Context, now time.Time, clean func(media.Inventory) error) ([]int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, quotaLock); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "UPDATE upload_jobs SET status='queued',updated_at=$1 WHERE status='processing' RETURNING guest_id", now)
	if err != nil {
		return nil, err
	}
	owners, err := readOwners(rows)
	if err != nil {
		return nil, err
	}
	inventory := media.Inventory{Inputs: map[string]bool{}, Photos: map[string]bool{}}
	rows, err = tx.QueryContext(ctx, "SELECT storage_key FROM upload_jobs WHERE status IN ('queued','processing')")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return nil, err
		}
		inventory.Inputs[key+".input"] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT filename,thumbnail FROM photos")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name, thumb string
		if err = rows.Scan(&name, &thumb); err != nil {
			rows.Close()
			return nil, err
		}
		inventory.Photos[name], inventory.Photos[thumb] = true, true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = clean(inventory); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return owners, nil
}
