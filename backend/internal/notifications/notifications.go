// Package notifications owns subscription rules and durable delivery decisions.
package notifications

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/locale"
)

const (
	// Lifetime is how long a queued notification stays worth delivering.
	Lifetime = 15 * time.Minute
	// MaxAttempts bounds deliveries of one notification, including the first.
	MaxAttempts  = 5
	queryTimeout = 5 * time.Second
	sendTimeout  = 10 * time.Second
)

type SigningKeys struct{ Public, Private string }

// Error identifies a business rejection without assigning an HTTP status.
type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

// Kind is the generic event a push message announces; it carries no content.
type Kind string

const (
	KindWelcomeStep Kind = "welcome_step"
	KindWelcomeOpen Kind = "welcome_open"
)

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
	Kind                Kind
	Locale              string
	Attempts            int
	ExpiresAt           time.Time
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
	NextAttempt time.Time
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
	keys, ok := normalizeKeys(input.Keys)
	if !ok || !locale.IsSupported(input.Locale) {
		return &Error{Code: "invalid_notification_subscription"}
	}
	input.Keys = keys
	return s.repository.Save(ctx, guest, sessionHash, input)
}

// normalizeKeys accepts padded or unpadded URL-safe base64 and requires an
// uncompressed P-256 point with a 16-byte authentication secret.
func normalizeKeys(input BrowserKeys) (BrowserKeys, bool) {
	if len(input.P256dh) > 88 || len(input.Auth) > 24 {
		return BrowserKeys{}, false
	}
	encoding := base64.RawURLEncoding.Strict()
	key, keyErr := encoding.DecodeString(strings.TrimRight(input.P256dh, "="))
	auth, authErr := encoding.DecodeString(strings.TrimRight(input.Auth, "="))
	if keyErr != nil || authErr != nil || len(auth) != 16 {
		return BrowserKeys{}, false
	}
	if _, err := ecdh.P256().NewPublicKey(key); err != nil {
		return BrowserKeys{}, false
	}
	return BrowserKeys{P256dh: base64.RawURLEncoding.EncodeToString(key), Auth: base64.RawURLEncoding.EncodeToString(auth)}, true
}

// ProcessNext delivers at most one due notification and reports whether it
// found one. Cancellation leaves interrupted work in the durable outbox, and a
// failed delivery is retried a bounded number of times before it is dropped.
func (s *Service) ProcessNext(ctx context.Context) (bool, error) {
	query, cancel := context.WithTimeout(ctx, queryTimeout)
	pending, found, err := s.repository.Next(query, s.now())
	cancel()
	if err != nil {
		return false, fmt.Errorf("read notification queue: %w", err)
	}
	if !found {
		return false, nil
	}
	result := DiscardDelivery
	if now := s.now(); s.endpointAllowed(pending.Endpoint) && pending.ExpiresAt.After(now) {
		send, cancelSend := context.WithTimeout(ctx, sendTimeout)
		result = s.sender.Send(send, pending, min(Lifetime, pending.ExpiresAt.Sub(now)))
		cancelSend()
	}
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	completion := Completion{Delivery: result}
	if result == RetryDelivery {
		// The repository only returns work with fewer than MaxAttempts attempts.
		delay := time.Duration(5*(1<<min(max(pending.Attempts, 0), 4))) * time.Second
		completion.NextAttempt = s.now().Add(delay)
		if pending.Attempts+1 >= MaxAttempts || !completion.NextAttempt.Before(pending.ExpiresAt) {
			completion.Delivery = DiscardDelivery
		}
	}
	update, cancelUpdate := context.WithTimeout(ctx, queryTimeout)
	defer cancelUpdate()
	if err := s.repository.Complete(update, pending, completion); err != nil {
		return true, fmt.Errorf("record notification delivery: %w", err)
	}
	return true, nil
}
