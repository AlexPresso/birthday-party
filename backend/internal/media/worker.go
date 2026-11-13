package media

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const (
	recordTimeout       = 10 * time.Second
	recordRetryInterval = time.Second
)

// retryDelays space the attempts that follow an infrastructure failure, such
// as a missing tool or full storage. Their sum is the outage a waiting upload
// survives before it fails for good.
var retryDelays = [...]time.Duration{30 * time.Second, 2 * time.Minute, 5 * time.Minute, 15 * time.Minute}

// MaxAttempts bounds how often one upload is prepared. A file that keeps
// failing for reasons other than its content then fails instead of occupying
// the workers forever.
const MaxAttempts = len(retryDelays) + 1

// ProcessNext claims and processes one queued upload. It reports false when
// nothing is waiting, so the caller can sleep until more work arrives.
func (s *Service) ProcessNext(ctx context.Context) (bool, error) {
	job, err := s.Claim(ctx)
	if errors.Is(err, ErrNoWork) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim media upload: %w", err)
	}
	s.Process(ctx, job)
	return true, nil
}

func (s *Service) prepareAndPublish(ctx context.Context, job Pending) error {
	output, err := s.files.Prepare(ctx, job)
	if err != nil {
		return err
	}
	retain, err := s.repo.Publish(ctx, job, output)
	if !retain {
		s.files.RemoveAttempt(job)
	}
	if err == nil {
		s.notify(job.GuestID)
	}
	return err
}

// Process prepares and publishes a claimed upload. A confirmed validation
// failure discards the input once its failed status has committed. Any other
// failure keeps the input and retries later, up to MaxAttempts.
func (s *Service) Process(ctx context.Context, job Pending) {
	if job.Attempts > MaxAttempts {
		// Earlier attempts ended without an outcome, for example by stopping the process.
		s.logf("process media upload %d: abandoned after %d attempts", job.ID, MaxAttempts)
		s.settle(ctx, job)
		return
	}
	err := s.prepareAndPublish(ctx, job)
	if errors.Is(err, ErrSuperseded) {
		return
	}
	if err == nil {
		s.files.RemoveInput(job.Key)
		return
	}
	var validation *Error
	if ctx.Err() == nil && errors.As(err, &validation) {
		s.reject(ctx, job, validation.Code)
		return
	}
	if ctx.Err() == nil {
		s.logf("process media upload %d (attempt %d of %d): %v", job.ID, job.Attempts, MaxAttempts, err)
	}
	s.settle(ctx, job)
}

// reject fails an upload whose content was confirmed invalid.
func (s *Service) reject(ctx context.Context, job Pending, code string) {
	failed, recorded := s.record(ctx, job, func(ctx context.Context) (bool, error) {
		return s.repo.Fail(ctx, job, code, s.now())
	})
	if !recorded {
		return
	}
	if failed {
		s.notify(job.GuestID)
		s.files.RemoveInput(job.Key)
	}
	s.files.RemoveAttempt(job)
}

// settle records an attempt that failed for a reason other than the content:
// the job waits for its next attempt, or fails once its attempts are used up.
// An interrupted worker always requeues, so a restart retries promptly.
func (s *Service) settle(ctx context.Context, job Pending) {
	interrupted := ctx.Err() != nil
	exhausted := !interrupted && job.Attempts >= MaxAttempts
	published := false
	changed, recorded := s.record(ctx, job, func(ctx context.Context) (bool, error) {
		// A commit whose response was lost may have published the upload after all.
		ready, err := s.repo.Ready(ctx, job.ID)
		if err != nil || ready {
			published = ready
			return false, err
		}
		now := s.now()
		if exhausted {
			return s.repo.Fail(ctx, job, exhaustedCode(job.Kind), now)
		}
		available := now
		if !interrupted {
			available = now.Add(retryDelays[min(max(job.Attempts, 1), len(retryDelays))-1])
		}
		return s.repo.Requeue(ctx, job, now, available)
	})
	switch {
	case !recorded:
	case published:
		s.notify(job.GuestID)
		s.files.RemoveInput(job.Key)
	case changed:
		s.notify(job.GuestID)
		s.files.RemoveAttempt(job)
		if exhausted {
			s.files.RemoveInput(job.Key)
		}
	}
}

// exhaustedCode is the failure shown to the owner when retries ran out.
func exhaustedCode(kind Kind) string {
	if kind == KindVideo {
		return "video_processing_failed"
	}
	return "photo_upload_failed"
}

// record stores the outcome of an attempt that did not publish. A job left in
// 'processing' would stay hidden until the next restart, so the update repeats
// until it is stored or the worker stops; startup recovery covers the latter.
// Each try outlives a cancelled worker so shutdown still returns its job.
func (s *Service) record(ctx context.Context, job Pending, update func(context.Context) (bool, error)) (changed, recorded bool) {
	for try := 1; ; try++ {
		bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordTimeout)
		changed, err := update(bounded)
		cancel()
		if err == nil {
			return changed, true
		}
		if ctx.Err() != nil {
			return false, false
		}
		if try == 1 {
			s.logf("record media upload %d outcome: %v; retrying", job.ID, err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(s.recordRetry):
		}
	}
}
