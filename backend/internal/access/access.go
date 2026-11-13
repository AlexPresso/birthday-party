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

// Viewer is an authorized guest and the digest of the session that proved their
// identity. Write transactions recheck that session under their own locks.
type Viewer struct {
	Guest       identity.Guest
	SessionHash string `json:"-"`
}

type Repository interface {
	Session(context.Context, string, time.Time) (Snapshot, error)
	// Realtime returns when the session expires and whether it has full app access.
	Realtime(context.Context, string, int64, time.Time) (time.Time, bool, error)
}

type Service struct{ repository Repository }

func New(repository Repository) *Service { return &Service{repository: repository} }

// Authorize resolves a session token and checks the requested capability.
func (s *Service) Authorize(ctx context.Context, token string, request Request, now time.Time) (Viewer, error) {
	if !identity.ValidToken(token) {
		return Viewer{}, ErrInvitation
	}
	sessionHash := identity.HashToken(token)
	snapshot, err := s.repository.Session(ctx, sessionHash, now)
	if err != nil {
		return Viewer{}, err
	}
	if err = Check(snapshot, request); err != nil {
		return Viewer{}, err
	}
	return Viewer{Guest: snapshot.Guest, SessionHash: sessionHash}, nil
}

func (s *Service) Realtime(ctx context.Context, sessionHash string, guestID int64, now time.Time) (time.Time, bool, error) {
	return s.repository.Realtime(ctx, sessionHash, guestID, now)
}

func Check(snapshot Snapshot, request Request) error {
	guest := snapshot.Guest
	if !guest.Active {
		return ErrExpired
	}
	if request.Admin && !guest.IsAdmin() {
		return ErrAdmin
	}
	if request.Scope == Session || guest.IsAdmin() || snapshot.Open {
		return nil
	}
	selfProfile := request.Scope == Profile && snapshot.ProfileWidget && (request.TargetGuestID == 0 || request.TargetGuestID == guest.ID)
	welcomeUpload := request.Scope == Upload && snapshot.MediaWidget
	if !selfProfile && !welcomeUpload {
		return ErrWelcome
	}
	return nil
}
