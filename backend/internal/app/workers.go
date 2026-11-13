package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	pgmedia "birthday-party/backend/internal/adapters/postgres/media"
	"birthday-party/backend/internal/media"
)

const (
	workerQueryTimeout = media.QueryTimeout
	mediaWorkers       = 2
	// The lock connection is checked often enough to stop a second owner early.
	workerLeaseCheck    = 5 * time.Second
	uploadHistoryPeriod = time.Minute
	// Queue workers are woken when work is committed. The poll only covers a
	// missed wake-up and work that becomes due later, such as a delayed retry.
	workerFallbackPoll = 5 * time.Second
)

// WorkerErrors reports conditions that retrying cannot repair, such as losing
// the connection whose advisory lock makes this process the only queue owner.
// The serving process must stop when it receives one. Callers must not close
// the channel; Close stops and waits for the workers.
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

// StartWorkers acquires exclusive queue ownership, recovers interrupted uploads
// and starts the background work of a serving process: media preparation,
// notification delivery, the programme unlock timer and queue maintenance.
// The workers run until parent is cancelled or Close is called.
// Only the serving process calls it; invitation and migration commands do not.
func (a *App) StartWorkers(parent context.Context) error {
	a.workerMu.Lock()
	defer a.workerMu.Unlock()
	if a.workerCancel != nil {
		return errors.New("background workers already started")
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
	start := func(run func(context.Context)) {
		a.workers.Go(func() { run(ctx) })
	}
	for range mediaWorkers {
		start(worker{name: "media upload", step: a.media.ProcessNext, wake: a.mediaWake, poll: workerFallbackPoll, delay: retryDelay}.run)
	}
	start(worker{name: "notification", step: a.notifications.ProcessNext, wake: a.notificationWake, poll: workerFallbackPoll, delay: retryDelay}.run)
	start(a.programmeWorker)
	start(a.maintainWorkers)
	return nil
}

// maintainWorkers verifies queue ownership and expires upload history. Losing
// the lock connection is the one failure a retry cannot repair: another process
// may already own the queues, so this process must stop its workers.
func (a *App) maintainWorkers(ctx context.Context) {
	ticker := time.NewTicker(workerLeaseCheck)
	defer ticker.Stop()
	lastCleanup := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		check, cancel := context.WithTimeout(ctx, workerQueryTimeout)
		err := a.workerConn.PingContext(check)
		cancel()
		if err != nil {
			if ctx.Err() == nil {
				a.reportWorkerError(fmt.Errorf("worker lock connection lost: %w", err))
			}
			return
		}
		if time.Since(lastCleanup) >= uploadHistoryPeriod {
			if err := a.media.CleanHistory(ctx); err != nil && ctx.Err() == nil {
				log.Printf("clean upload history: %v", err)
			}
			lastCleanup = time.Now()
		}
	}
}
