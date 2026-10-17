// Package notifications owns subscription rules and durable delivery decisions.
package notifications

import (
	"context"
	"crypto/elliptic"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"birthday-party/backend/internal/identity"
)

const Lifetime = 15 * time.Minute
const queryTimeout = 5 * time.Second

type SigningKeys struct{ Public, Private string }

// Error identifies a business rejection without assigning an HTTP status.
type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

type BrowserKeys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type Subscription struct {
	Endpoint string      `json:"endpoint"`
	Keys     BrowserKeys `json:"keys"`
	Locale   string      `json:"locale"`
}

// RegistrationAccess is read under the subscription transaction's row locks.
type RegistrationAccess struct {
	Active             bool
	SessionValid       bool
	Admin              bool
	Open               bool
	NotificationWidget bool
	OtherSubscriptions int
}

func AuthorizeRegistration(access RegistrationAccess) error {
	if !access.Active {
		return &Error{Code: "access_revoked"}
	}
	if !access.SessionValid {
		return &Error{Code: "session_expired"}
	}
	if !access.Admin && !access.Open && !access.NotificationWidget {
		return &Error{Code: "welcome_required"}
	}
	if access.OtherSubscriptions >= 10 {
		return &Error{Code: "notification_subscription_limit"}
	}
	return nil
}

type Pending struct {
	SubscriptionID      int64
	SubscriptionVersion int64
	Revision            int64
	Endpoint            string
	Keys                BrowserKeys
	Kind                string
	Locale              string
	Attempts            int
	ExpiresAt           int64
}

type Delivery uint8

const (
	Delivered Delivery = iota
	RetryDelivery
	RemoveSubscription
	DiscardDelivery
)

type Completion struct {
	Delivery    Delivery
	NextAttempt int64
}

// Repository keeps registration authorization atomic and returns eligible work only.
// Completion is conditional on subscription version and outbox revision, so a
// concurrent host update cannot be removed by an older delivery.
type Repository interface {
	Status(context.Context, int64, string, string) (bool, error)
	Delete(context.Context, int64, string, string) error
	Save(context.Context, identity.Guest, string, Subscription) error
	Next(context.Context, time.Time) (Pending, bool, error)
	Complete(context.Context, Pending, Completion) error
}

// Sender delivers a generic notification without exposing transport details.
type Sender interface {
	Send(context.Context, Pending, time.Duration) Delivery
}

type Service struct {
	repository      Repository
	sender          Sender
	endpointAllowed func(string) bool
	now             func() time.Time
}

func New(repository Repository, sender Sender, endpointAllowed func(string) bool, now func() time.Time) *Service {
	return &Service{repository: repository, sender: sender, endpointAllowed: endpointAllowed, now: now}
}

func (s *Service) validateEndpoint(endpoint string) error {
	if !s.endpointAllowed(endpoint) {
		return &Error{Code: "invalid_notification_subscription"}
	}
	return nil
}

func (s *Service) Status(ctx context.Context, guestID int64, sessionHash, endpoint string) (bool, error) {
	if err := s.validateEndpoint(endpoint); err != nil {
		return false, err
	}
	return s.repository.Status(ctx, guestID, sessionHash, identity.HashToken(endpoint))
}

func (s *Service) Delete(ctx context.Context, guestID int64, sessionHash, endpoint string) error {
	if err := s.validateEndpoint(endpoint); err != nil {
		return err
	}
	return s.repository.Delete(ctx, guestID, sessionHash, identity.HashToken(endpoint))
}

func (s *Service) Save(ctx context.Context, guest identity.Guest, sessionHash string, input Subscription) error {
	if err := s.validateEndpoint(input.Endpoint); err != nil {
		return err
	}
	key, keyError := base64.RawURLEncoding.Strict().DecodeString(strings.TrimRight(input.Keys.P256dh, "="))
	auth, authError := base64.RawURLEncoding.Strict().DecodeString(strings.TrimRight(input.Keys.Auth, "="))
	x, _ := elliptic.Unmarshal(elliptic.P256(), key)
	validLocale := input.Locale == "en" || input.Locale == "fr" || input.Locale == "de" || input.Locale == "it" || input.Locale == "es"
	if len(input.Keys.P256dh) > 88 || len(input.Keys.Auth) > 24 || keyError != nil || authError != nil || len(auth) != 16 || x == nil || !validLocale {
		return &Error{Code: "invalid_notification_subscription"}
	}
	input.Keys = BrowserKeys{P256dh: base64.RawURLEncoding.EncodeToString(key), Auth: base64.RawURLEncoding.EncodeToString(auth)}
	return s.repository.Save(ctx, guest, sessionHash, input)
}

// ProcessNext preserves accepted work across interruptions and bounds retries.
func (s *Service) ProcessNext(ctx context.Context) (bool, error) {
	query, cancel := context.WithTimeout(ctx, queryTimeout)
	pending, found, err := s.repository.Next(query, s.now())
	cancel()
	if err != nil || !found {
		return false, err
	}
	result := DiscardDelivery
	if s.endpointAllowed(pending.Endpoint) && pending.ExpiresAt > s.now().Unix() {
		ttl := min(Lifetime, time.Duration(pending.ExpiresAt-s.now().Unix())*time.Second)
		send, cancelSend := context.WithTimeout(ctx, 10*time.Second)
		result = s.sender.Send(send, pending, max(0, ttl))
		cancelSend()
	}
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	completion := Completion{Delivery: result}
	if result == RetryDelivery {
		// Repository work is bounded to fewer than five prior attempts.
		delay := time.Duration(5*(1<<min(max(pending.Attempts, 0), 4))) * time.Second
		completion.NextAttempt = s.now().Add(delay).Unix()
		if pending.Attempts+1 >= 5 || completion.NextAttempt >= pending.ExpiresAt {
			completion.Delivery = DiscardDelivery
		}
	}
	update, cancelUpdate := context.WithTimeout(ctx, queryTimeout)
	defer cancelUpdate()
	return true, s.repository.Complete(update, pending, completion)
}

// Run owns the delivery loop; cancellation leaves interrupted work durable.
func (s *Service) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for ctx.Err() == nil {
		processed, err := s.ProcessNext(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errors.New("notification queue is unavailable")
		}
		if processed {
			continue
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
	return ctx.Err()
}
