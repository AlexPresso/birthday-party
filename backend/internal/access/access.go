// Package access decides which authenticated guests can enter each capability.
package access

import (
	"context"
	"time"

	"birthday-party/backend/internal/identity"
)

type Scope uint8

const (
	Session Scope = iota
	Party
	Profile
	Upload
)

type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrInvitation Error = "invitation_required"
	ErrExpired    Error = "session_expired"
	ErrAdmin      Error = "admin_required"
	ErrWelcome    Error = "welcome_required"
)

type Snapshot struct {
	Guest         identity.Guest
	Open          bool
	ProfileWidget bool
	MediaWidget   bool
}

type Request struct {
	Admin         bool
	Scope         Scope
	TargetGuestID int64
}

type Repository interface {
	Session(context.Context, string, time.Time) (Snapshot, error)
	Realtime(context.Context, string, int64, time.Time) (int64, bool, error)
}

type Service struct{ repository Repository }

func New(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) Authorize(ctx context.Context, token string, request Request, now time.Time) (identity.Guest, error) {
	if !identity.ValidToken(token) {
		return identity.Guest{}, ErrInvitation
	}
	snapshot, err := s.repository.Session(ctx, identity.HashToken(token), now)
	if err != nil {
		return identity.Guest{}, err
	}
	if err = Check(snapshot, request); err != nil {
		return identity.Guest{}, err
	}
	return snapshot.Guest, nil
}

func (s *Service) Realtime(ctx context.Context, sessionHash string, guestID int64, now time.Time) (int64, bool, error) {
	return s.repository.Realtime(ctx, sessionHash, guestID, now)
}

func Check(snapshot Snapshot, request Request) error {
	guest := snapshot.Guest
	if !guest.Active {
		return ErrExpired
	}
	if request.Admin && guest.Role != "admin" {
		return ErrAdmin
	}
	if request.Scope == Session || guest.Role == "admin" || snapshot.Open {
		return nil
	}
	selfProfile := request.Scope == Profile && snapshot.ProfileWidget && (request.TargetGuestID == 0 || request.TargetGuestID == guest.ID)
	welcomeUpload := request.Scope == Upload && snapshot.MediaWidget
	if !selfProfile && !welcomeUpload {
		return ErrWelcome
	}
	return nil
}
