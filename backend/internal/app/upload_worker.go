package app

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"
)

const workerQueryTimeout = 5 * time.Second

// WorkerErrors reports failures that require the serving process to restart.
// Callers must not close the channel; Close stops and waits for the workers.
func (a *App) WorkerErrors() <-chan error { return a.workerErrors }

func (a *App) reportWorkerError(err error) {
	select {
	case a.workerErrors <- err:
	default:
	}
	a.workerMu.Lock()
	if a.workerCancel != nil {
		a.workerCancel()
	}
	a.workerMu.Unlock()
}

// StartWorkers acquires exclusive queue ownership, recovers interrupted uploads,
// and starts two media workers and one notification worker until parent is
// cancelled or Close is called.
// Only the serving process calls it; invitation and migration commands do not.
func (a *App) StartWorkers(parent context.Context) error {
	a.workerMu.Lock()
	defer a.workerMu.Unlock()
	if a.workerCancel != nil {
		return errors.New("media workers already started")
	}
	startup, cancelStartup := context.WithTimeout(parent, time.Minute)
	defer cancelStartup()
	conn, err := a.db.Conn(startup)
	if err != nil {
		return err
	}
	var locked bool
	if err = conn.QueryRowContext(startup, "SELECT pg_try_advisory_lock(hashtext(current_schema()),73002)").Scan(&locked); err != nil {
		// The lock may have been granted before its response was lost.
		return errors.Join(err, releaseWorkerConnection(conn))
	}
	if !locked {
		conn.Close()
		return errors.New("another media worker process is already running")
	}
	failStart := func(err error) error {
		return errors.Join(err, releaseWorkerConnection(conn))
	}
	// Recovery shares the same lock order as reception, claims and publication.
	// No process may publish a file while its database references are being scanned.
	recovery, err := a.db.BeginTx(startup, nil)
	if err != nil {
		return failStart(err)
	}
	defer recovery.Rollback()
	if _, err = recovery.ExecContext(startup, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		return failStart(err)
	}
	if _, err = recovery.ExecContext(startup, "UPDATE upload_jobs SET status='queued',updated_at=$1 WHERE status='processing'", stamp(a.now())); err != nil {
		return failStart(err)
	}
	if err = a.recoverUploadFiles(startup); err != nil {
		return failStart(err)
	}
	if err = recovery.Commit(); err != nil {
		return failStart(err)
	}
	ctx, cancel := context.WithCancel(parent)
	a.workerCancel = cancel
	a.workerConn = conn
	for range 2 {
		a.workers.Add(1)
		go func() { defer a.workers.Done(); a.mediaWorker(ctx) }()
	}
	a.workers.Add(1)
	go func() { defer a.workers.Done(); a.notificationWorker(ctx) }()
	a.workers.Add(1)
	go func() {
		defer a.workers.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		lastCleanup := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check, cancelCheck := context.WithTimeout(ctx, workerQueryTimeout)
				err := conn.PingContext(check)
				cancelCheck()
				if err != nil {
					if ctx.Err() == nil {
						a.reportWorkerError(fmt.Errorf("media worker lock connection lost: %w", err))
					}
					cancel()
					return
				}
				if time.Since(lastCleanup) >= time.Minute {
					if err := a.cleanUploadHistory(ctx); err != nil && ctx.Err() == nil {
						log.Printf("clean upload history: %v", err)
					}
					lastCleanup = time.Now()
				}
			}
		}
	}()
	return nil
}

func releaseWorkerConnection(conn *sql.Conn) error {
	ctx, cancel := context.WithTimeout(context.Background(), workerQueryTimeout)
	defer cancel()
	_, unlockErr := conn.ExecContext(ctx, "SELECT pg_advisory_unlock(hashtext(current_schema()),73002)")
	if unlockErr != nil {
		// Never return a session with uncertain lock ownership to the pool.
		// ErrBadConn makes database/sql discard the underlying connection.
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

func (a *App) mediaWorker(ctx context.Context) {
	for ctx.Err() == nil {
		job, err := a.claimUpload(ctx)
		if err == nil {
			a.processUpload(ctx, job)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
			// The UPDATE may have committed before its RETURNING response was lost.
			// Restart to recover that processing row instead of silently abandoning it.
			a.reportWorkerError(fmt.Errorf("claim media upload: %w", err))
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(300 * time.Millisecond):
		}
	}
}

func (a *App) processUpload(ctx context.Context, job pendingUpload) {
	err := a.prepareAndStoreUpload(ctx, job)
	if errors.Is(err, errUploadSuperseded) {
		return
	}
	if err == nil {
		os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
		return
	}
	// Retain raw input on shutdown or infrastructure errors; a later attempt can finish it.
	var validation *mediaValidationError
	terminal := errors.As(err, &validation)
	updateCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if ctx.Err() != nil || !terminal {
		if ctx.Err() == nil {
			log.Printf("process media upload %d: %v", job.id, err)
		}
		var status string
		if a.db.QueryRowContext(updateCtx, "SELECT status FROM upload_jobs WHERE id=$1", job.id).Scan(&status) == nil && status == "ready" {
			os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
			return
		}
		result, updateErr := a.db.ExecContext(updateCtx, "UPDATE upload_jobs SET status='queued',updated_at=$1 WHERE id=$2 AND status='processing' AND attempt_id=$3", stamp(a.now()), job.id, job.attempt)
		if updateErr != nil {
			if ctx.Err() == nil {
				a.reportWorkerError(fmt.Errorf("requeue media upload %d: %w", job.id, updateErr))
			}
		}
		if updateErr == nil {
			if count, _ := result.RowsAffected(); count > 0 {
				a.removeAttemptOutputs(job)
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
		return
	}
	result, updateErr := a.db.ExecContext(updateCtx, "UPDATE upload_jobs SET status='failed',error_code=$1,updated_at=$2 WHERE id=$3 AND status='processing' AND attempt_id=$4", validation.code, stamp(a.now()), job.id, job.attempt)
	if updateErr != nil {
		if ctx.Err() == nil {
			a.reportWorkerError(fmt.Errorf("fail media upload %d: %w", job.id, updateErr))
		}
		return
	}
	if count, _ := result.RowsAffected(); count > 0 {
		os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
	}
	a.removeAttemptOutputs(job)
}

func (a *App) removeAttemptOutputs(job pendingUpload) {
	for _, suffix := range []string{".jpg", ".png", ".webp", ".mp4", ".thumb.jpg"} {
		os.Remove(filepath.Join(a.config.DataDir, "photos", job.key+"-"+job.attempt+suffix))
	}
}
