package identity

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidName           = errors.New("name must contain 1–80 characters")
	ErrInvalidInvitation     = errors.New("invalid invitation token")
	ErrUnavailableInvitation = errors.New("invitation is unavailable")
	ErrUsedInvitation        = errors.New("invitation has already been used")
	ErrLimitReached          = errors.New("guest limit reached")
	ErrNotFound              = errors.New("guest not found")
	ErrSelfRevoke            = errors.New("cannot revoke your own identity")
)

const guestLimit = 500

// Repository provides atomic identity workflows without exposing transaction handles.
type Repository interface {
	List(context.Context, int) ([]Guest, error)
	// Invitation issuance callbacks run after acquiring the relevant guest locks.
	CreateGuest(context.Context, string, func() (Credential, error), int) (Guest, error)
	EnsureAdminInvitation(context.Context, *string, func() (Credential, error)) error
	RenewInvitation(context.Context, int64, func() (Credential, error)) error
	Invitation(context.Context, string) (PendingInvitation, error)
	// ConsumeInvitation calls grant while the guest is locked, then consumes the
	// invitation and creates/prunes sessions in that same transaction.
	ConsumeInvitation(context.Context, string, func(PendingInvitation) (SessionGrant, error)) (Guest, error)
	Revoke(context.Context, int64) error
	Logout(context.Context, string) error
}

// Service owns identity validation, token issuance and invitation/session policy.
type Service struct {
	repository Repository
	publicURL  string
}

// New uses the supplied persistence port and validated public application origin.
func New(repository Repository, publicURL string) *Service {
	return &Service{repository: repository, publicURL: publicURL}
}

func normalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return "", ErrInvalidName
	}
	return name, nil
}

// List returns the bounded guest list for an administrator.
func (s *Service) List(ctx context.Context) ([]Guest, error) {
	return s.repository.List(ctx, guestLimit)
}

// Create adds a guest and their invitation in one atomic operation.
func (s *Service) Create(ctx context.Context, name string, now func() time.Time) (Guest, Invitation, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Guest{}, Invitation{}, err
	}
	var issued Invitation
	guest, err := s.repository.CreateGuest(ctx, name, func() (Credential, error) {
		var credential Credential
		var err error
		issued, credential, err = s.issueInvitation(now())
		return credential, err
	}, guestLimit)
	if err != nil {
		return Guest{}, Invitation{}, err
	}
	return guest, issued, nil
}

// Revoke disables a guest and removes their sessions and invitations atomically.
func (s *Service) Revoke(ctx context.Context, id, viewerID int64) error {
	if id == viewerID {
		return ErrSelfRevoke
	}
	return s.repository.Revoke(ctx, id)
}
