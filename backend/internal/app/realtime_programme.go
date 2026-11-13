package app

import (
	"context"
	"log"
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

// programmeWorker announces each scheduled unlock when it is reached. It sleeps
// until the next unlock, a host edit or, after a failed read, a retry delay.
func (a *App) programmeWorker(ctx context.Context) {
	failures := 0
	for ctx.Err() == nil {
		next, err := a.nextProgrammeUnlock(ctx)
		if ctx.Err() != nil {
			return
		}
		var timer *time.Timer
		var elapsed <-chan time.Time
		switch {
		case err != nil:
			failures++
			wait := retryDelay(failures)
			log.Printf("schedule programme unlock: %v; retrying in %s", err, wait.Round(time.Millisecond))
			timer = time.NewTimer(wait)
		case !next.IsZero():
			failures = 0
			timer = time.NewTimer(max(0, next.Sub(a.now())))
		default:
			failures = 0
		}
		if timer != nil {
			elapsed = timer.C
		}
		select {
		case <-ctx.Done():
		case <-a.programmeReschedule:
		case <-elapsed:
			if err == nil && !a.now().Before(next) {
				a.realtime.notify(0, realtimeProgramme)
			}
		}
		if timer != nil {
			timer.Stop()
		}
	}
}
