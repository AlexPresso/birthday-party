package app

import (
	"context"
	"fmt"
	"time"
)

func (a *App) programmeChanged() {
	a.realtime.notify(0, realtimeProgramme)
	select {
	case a.programmeReschedule <- struct{}{}:
	default:
	}
}

func (a *App) nextProgrammeUnlock(ctx context.Context) (time.Time, error) {
	query, cancel := context.WithTimeout(ctx, workerQueryTimeout)
	defer cancel()
	return a.programme.NextUnlock(query, a.now())
}

func (a *App) programmeWorker(ctx context.Context) {
	for ctx.Err() == nil {
		next, err := a.nextProgrammeUnlock(ctx)
		if err != nil {
			if ctx.Err() == nil {
				a.reportWorkerError(fmt.Errorf("schedule programme unlock: %w", err))
			}
			return
		}
		var timer *time.Timer
		var deadline <-chan time.Time
		if !next.IsZero() {
			timer = time.NewTimer(max(0, next.Sub(a.now())))
			deadline = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case <-a.programmeReschedule:
			if timer != nil {
				timer.Stop()
			}
		case <-deadline:
			if !a.now().Before(next) {
				a.realtime.notify(0, realtimeProgramme)
			}
		}
	}
}
