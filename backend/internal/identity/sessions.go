package identity

import (
	"context"
	"time"
)

// Session is an accepted invitation; Token is used only to set the browser cookie.
type Session struct {
	Guest     Guest
	Token     string `json:"-"`
	ExpiresAt time.Time
}

// SessionGrant describes the session to persist when an invitation is consumed.
type SessionGrant struct {
	Credential   Credential
	CreatedAt    time.Time
	SessionLimit int
}

// AcceptInvitation checks current invitation state under its guest lock, then
// consumes it and creates a bounded browser session in the same transaction.
func (s *Service) AcceptInvitation(ctx context.Context, invitationToken string, clock func() time.Time) (Session, error) {
	if !ValidToken(invitationToken) {
		return Session{}, ErrInvalidInvitation
	}
	var session Session
	guest, err := s.repository.ConsumeInvitation(ctx, HashToken(invitationToken), func(invitation PendingInvitation) (SessionGrant, error) {
		now := clock()
		if !invitation.available(now) {
			return SessionGrant{}, ErrUnavailableInvitation
		}
		token, err := NewToken()
		if err != nil {
			return SessionGrant{}, err
		}
		session.Token = token
		session.ExpiresAt = now.Add(SessionTTL)
		return SessionGrant{Credential: Credential{TokenHash: HashToken(token), ExpiresAt: session.ExpiresAt}, CreatedAt: now, SessionLimit: 5}, nil
	})
	if err != nil {
		return Session{}, err
	}
	session.Guest = guest
	return session, nil
}

// Logout removes the session and its dependent notification subscriptions.
func (s *Service) Logout(ctx context.Context, tokenHash string) error {
	return s.repository.Logout(ctx, tokenHash)
}
