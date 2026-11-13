package app

import (
	"context"
	"log"
	"math/rand/v2"
	"time"
)

const (
	workerRetryBase = time.Second
	workerRetryMax  = 30 * time.Second
)

// worker repeats one unit of background work until its context ends.
//
// A step reports whether it found work. A busy worker continues at once, an
// idle one sleeps until it is woken or the fallback poll elapses, and a failed
// step is logged and retried after a bounded, jittered delay. A transient
// database outage therefore delays durable work instead of ending the process.
type worker struct {
	name  string
	step  func(context.Context) (bool, error)
	wake  <-chan struct{}
	poll  time.Duration
	delay func(failures int) time.Duration
}

func (w worker) run(ctx context.Context) {
	failures := 0
	for ctx.Err() == nil {
		worked, err := w.step(ctx)
		if ctx.Err() != nil {
			return
		}
		if err == nil && worked {
			failures = 0
			continue
		}
		// A wake-up only shortens an idle wait. It stays buffered during a retry
		// delay, so pending work is still picked up right after the delay.
		wait, wake := w.poll, w.wake
		if err != nil {
			failures++
			wait, wake = w.delay(failures), nil
			log.Printf("%s worker: %v; retrying in %s", w.name, err, wait.Round(time.Millisecond))
		} else {
			failures = 0
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
		case <-wake:
		case <-timer.C:
		}
		timer.Stop()
	}
}

// retryDelay doubles with consecutive failures up to workerRetryMax. The upper
// half of each window is random so parallel workers do not retry in lockstep.
func retryDelay(failures int) time.Duration {
	ceiling := min(workerRetryBase<<min(max(failures-1, 0), 5), workerRetryMax)
	return ceiling/2 + rand.N(ceiling/2+1)
}

// wakeSignal tells idle workers that work may be waiting. Signals carry no
// payload and coalesce: at most one is buffered per worker, because a woken
// worker keeps going until its queue is empty. The queues live in PostgreSQL,
// so a lost or extra signal only delays work until the fallback poll.
type wakeSignal chan struct{}

func newWakeSignal(workers int) wakeSignal { return make(wakeSignal, workers) }

// notify never blocks. Call it after the work has been committed.
func (s wakeSignal) notify() {
	for range cap(s) {
		select {
		case s <- struct{}{}:
		default:
			return
		}
	}
}
