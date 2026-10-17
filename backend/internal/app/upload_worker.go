package app

import (
	pgmedia "birthday-party/backend/internal/adapters/postgres/media"
	"birthday-party/backend/internal/media"
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

const workerQueryTimeout = media.QueryTimeout

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
	conn, err := a.mediaStore.AcquireWorkers(startup)
	if err != nil {
		return err
	}
	failStart := func(err error) error { return errors.Join(err, pgmedia.ReleaseWorkerConnection(conn)) }
	owners, err := a.mediaStore.Recover(startup, a.now(), a.mediaFiles.Recover)
	if err != nil {
		return failStart(err)
	}
	for _, owner := range owners {
		a.realtime.notify(owner, realtimeUploads)
	}
	if err = a.media.CleanHistory(startup); err != nil {
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
	go func() { defer a.workers.Done(); a.programmeWorker(ctx) }()
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
					if err := a.media.CleanHistory(ctx); err != nil && ctx.Err() == nil {
						log.Printf("clean upload history: %v", err)
					}
					lastCleanup = time.Now()
				}
			}
		}
	}()
	return nil
}

func (a *App) mediaWorker(ctx context.Context) {
	if err := a.media.Run(ctx); err != nil && ctx.Err() == nil {
		a.reportWorkerError(err)
	}
}
