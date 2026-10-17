package notifications

import (
	"context"
	"errors"
	"testing"
	"time"
)

type queueStub struct {
	Repository
	pending   Pending
	completed []Completion
	snapshots []Pending
}

func (q *queueStub) Next(context.Context, time.Time) (Pending, bool, error) {
	return q.pending, true, nil
}

func (q *queueStub) Complete(_ context.Context, pending Pending, completion Completion) error {
	q.snapshots = append(q.snapshots, pending)
	q.completed = append(q.completed, completion)
	return nil
}

type senderFunc func(context.Context, Pending, time.Duration) Delivery

func (f senderFunc) Send(ctx context.Context, pending Pending, ttl time.Duration) Delivery {
	return f(ctx, pending, ttl)
}

func TestRegistrationAccess(t *testing.T) {
	for _, test := range []struct {
		name   string
		access RegistrationAccess
		code   string
	}{
		{"revoked before other failures", RegistrationAccess{}, "access_revoked"},
		{"expired before welcome", RegistrationAccess{Active: true}, "session_expired"},
		{"waiting without widget", RegistrationAccess{Active: true, SessionValid: true}, "welcome_required"},
		{"current notification widget", RegistrationAccess{Active: true, SessionValid: true, NotificationWidget: true}, ""},
		{"full access", RegistrationAccess{Active: true, SessionValid: true, Open: true}, ""},
		{"administrator during welcome", RegistrationAccess{Active: true, SessionValid: true, Admin: true}, ""},
		{"quota also applies to administrators", RegistrationAccess{Active: true, SessionValid: true, Admin: true, OtherSubscriptions: 10}, "notification_subscription_limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := AuthorizeRegistration(test.access)
			if test.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var rejection *Error
			if !errors.As(err, &rejection) || rejection.Code != test.code {
				t.Fatalf("error = %v; want %s", err, test.code)
			}
		})
	}
}

func TestDeliveryRetryAndExpiry(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name      string
		attempts  int
		remaining time.Duration
		transport Delivery
		want      Delivery
		delay     time.Duration
		sends     bool
	}{
		{"first retry", 0, time.Minute, RetryDelivery, RetryDelivery, 5 * time.Second, true},
		{"later retry", 3, time.Minute, RetryDelivery, RetryDelivery, 40 * time.Second, true},
		{"last attempt", 4, Lifetime, RetryDelivery, DiscardDelivery, 80 * time.Second, true},
		{"retry exactly at expiry", 0, 5 * time.Second, RetryDelivery, DiscardDelivery, 5 * time.Second, true},
		{"already expired", 0, 0, Delivered, DiscardDelivery, 0, false},
		{"endpoint gone", 0, time.Minute, RemoveSubscription, RemoveSubscription, 0, true},
		{"successful delivery", 0, Lifetime + time.Hour, Delivered, Delivered, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			q := &queueStub{pending: Pending{SubscriptionID: 11, SubscriptionVersion: 3, Revision: 7, Endpoint: "allowed", Attempts: test.attempts, ExpiresAt: now.Add(test.remaining).Unix()}}
			calls := 0
			sender := senderFunc(func(ctx context.Context, pending Pending, ttl time.Duration) Delivery {
				calls++
				if ttl != min(Lifetime, test.remaining) {
					t.Fatalf("TTL = %v", ttl)
				}
				if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 10*time.Second {
					t.Fatal("delivery has no bounded deadline")
				}
				return test.transport
			})
			s := New(q, sender, func(string) bool { return true }, func() time.Time { return now })
			processed, err := s.ProcessNext(t.Context())
			if err != nil || !processed {
				t.Fatalf("processed=%v error=%v", processed, err)
			}
			if (calls == 1) != test.sends {
				t.Fatalf("send calls = %d", calls)
			}
			if len(q.completed) != 1 || q.completed[0].Delivery != test.want {
				t.Fatalf("completion = %+v", q.completed)
			}
			if q.snapshots[0] != q.pending {
				t.Fatal("completion lost the version or revision used for delivery")
			}
			if test.delay > 0 && q.completed[0].NextAttempt != now.Add(test.delay).Unix() {
				t.Fatal("incorrect retry delay")
			}
		})
	}
}

func TestCancelledDeliveryKeepsDurableWork(t *testing.T) {
	now := time.Now()
	q := &queueStub{pending: Pending{Endpoint: "allowed", ExpiresAt: now.Add(Lifetime).Unix()}}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	s := New(q, senderFunc(func(context.Context, Pending, time.Duration) Delivery {
		cancel()
		return RetryDelivery
	}), func(string) bool { return true }, func() time.Time { return now })
	if _, err := s.ProcessNext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if len(q.completed) != 0 {
		t.Fatal("interrupted work was completed")
	}
}

func TestRejectedEndpointCannotReachTransport(t *testing.T) {
	q := &queueStub{pending: Pending{Endpoint: "forbidden", ExpiresAt: time.Now().Add(Lifetime).Unix()}}
	s := New(q, senderFunc(func(context.Context, Pending, time.Duration) Delivery {
		t.Fatal("forbidden endpoint reached the transport")
		return Delivered
	}), func(string) bool { return false }, time.Now)
	if _, err := s.Status(t.Context(), 1, "session", "forbidden"); err == nil {
		t.Fatal("invalid endpoint accepted")
	}
	if _, err := s.ProcessNext(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(q.completed) != 1 || q.completed[0].Delivery != DiscardDelivery {
		t.Fatal("forbidden delivery was retained")
	}
}
