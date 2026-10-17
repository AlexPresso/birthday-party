package media

import (
	"context"
	"errors"
	"fmt"
	"time"
)

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

// Process retains inputs on uncertain infrastructure outcomes. Only an explicit
// validation failure discards an input after its failed status has committed.
func (s *Service) Process(ctx context.Context, job Pending) error {
	err := s.prepareAndPublish(ctx, job)
	if errors.Is(err, ErrSuperseded) {
		return nil
	}
	if err == nil {
		s.files.RemoveInput(job.Key)
		return nil
	}
	var validation *Error
	terminal := errors.As(err, &validation)
	updateCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if ctx.Err() != nil || !terminal {
		if ctx.Err() == nil {
			s.logf("process media upload %d: %v", job.ID, err)
		}
		if ready, checkErr := s.repo.Ready(updateCtx, job.ID); checkErr == nil && ready {
			s.notify(job.GuestID)
			s.files.RemoveInput(job.Key)
			return nil
		}
		changed, updateErr := s.repo.Requeue(updateCtx, job, s.now())
		if updateErr != nil && ctx.Err() == nil {
			return fmt.Errorf("requeue media upload %d: %w", job.ID, updateErr)
		}
		if changed {
			s.notify(job.GuestID)
			s.files.RemoveAttempt(job)
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
		return nil
	}
	changed, updateErr := s.repo.Fail(updateCtx, job, validation.Code, s.now())
	if updateErr != nil {
		if ctx.Err() == nil {
			return fmt.Errorf("fail media upload %d: %w", job.ID, updateErr)
		}
		return nil
	}
	if changed {
		s.notify(job.GuestID)
		s.files.RemoveInput(job.Key)
	}
	s.files.RemoveAttempt(job)
	return nil
}

// Run owns one bounded worker loop. The serving process starts exactly two.
func (s *Service) Run(ctx context.Context) error {
	for ctx.Err() == nil {
		job, err := s.Claim(ctx)
		if err == nil {
			if err := s.Process(ctx, job); err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, ErrNoWork) && ctx.Err() == nil {
			return fmt.Errorf("claim media upload: %w", err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(300 * time.Millisecond):
		}
	}
	return nil
}
