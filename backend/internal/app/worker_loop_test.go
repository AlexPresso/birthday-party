package app

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestWorkerRetriesFailedStepsInsteadOfStopping(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	results := []error{errors.New("database unavailable"), errors.New("database unavailable"), nil, nil}
	steps := 0
	var delays []int
	loop := worker{
		name: "test",
		poll: time.Hour,
		step: func(context.Context) (bool, error) {
			steps++
			if steps > len(results) {
				cancel()
				return false, nil
			}
			return true, results[steps-1]
		},
		delay: func(failures int) time.Duration {
			delays = append(delays, failures)
			return time.Millisecond
		},
	}
	finished := make(chan struct{})
	go func() { loop.run(ctx); close(finished) }()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not keep running after failed steps")
	}
	if steps != len(results)+1 || !slices.Equal(delays, []int{1, 2}) {
		t.Fatalf("steps=%d consecutive failures=%v", steps, delays)
	}
}

func TestIdleWorkerSleepsUntilWokenOrPolled(t *testing.T) {
	for _, test := range []struct {
		name string
		poll time.Duration
		wake bool
	}{
		{"wake-up", time.Hour, true},
		{"fallback poll", 10 * time.Millisecond, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			wake := make(chan struct{}, 1)
			stepped := make(chan struct{}, 8)
			loop := worker{
				name: "test", wake: wake, poll: test.poll, delay: retryDelay,
				step: func(context.Context) (bool, error) {
					stepped <- struct{}{}
					return false, nil
				},
			}
			finished := make(chan struct{})
			go func() { loop.run(ctx); close(finished) }()
			<-stepped
			if test.wake {
				select {
				case <-stepped:
					t.Fatal("idle worker ran again before any wake-up")
				case <-time.After(50 * time.Millisecond):
				}
				wake <- struct{}{}
			}
			select {
			case <-stepped:
			case <-time.After(5 * time.Second):
				t.Fatal("idle worker did not check for work again")
			}
			cancel()
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("worker ignored cancellation")
			}
		})
	}
}

func TestRetryDelayIsJitteredAndBounded(t *testing.T) {
	longest := map[time.Duration]bool{}
	for failures := 1; failures <= 60; failures++ {
		delay := retryDelay(failures)
		if delay < workerRetryBase/2 || delay > workerRetryMax {
			t.Fatalf("failures=%d delay=%v outside [%v, %v]", failures, delay, workerRetryBase/2, workerRetryMax)
		}
		if failures > 10 {
			if delay < workerRetryMax/2 {
				t.Fatalf("failures=%d delay=%v stopped growing", failures, delay)
			}
			longest[delay] = true
		}
	}
	if retryDelay(1) > workerRetryBase {
		t.Fatal("first retry waits longer than the base delay")
	}
	if len(longest) < 2 {
		t.Fatal("repeated failures retry in lockstep")
	}
}
