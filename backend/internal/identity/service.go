package identity

import (
	"context"
	"errors"
	"regexp"
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
	ErrInvalidPhone          = errors.New("phone number must be international, such as +41 79 123 45 67")
	// Permanent deletion only follows revocation, and waits for the guest
	// to leave work that still needs them.
	ErrGuestActive  = errors.New("guest still has access")
	ErrGuestUploads = errors.New("guest still has uploads in preparation")
	ErrGuestInGame  = errors.New("guest plays or leads a running werewolf game")
)

const guestLimit = 500

// Repository provides atomic identity workflows without exposing transaction handles.
type Repository interface {
	List(context.Context, int) ([]Guest, error)
	// Invitation issuance callbacks run after acquiring the relevant guest locks.
	CreateGuest(context.Context, string, *string, func() (Credential, error), int) (Guest, error)
	// UpdateGuest renames a guest and sets their number. When an active
	// guest's number changes, it calls issue and replaces their invitation in
	// the same transaction.
	UpdateGuest(ctx context.Context, id int64, name string, phone *string, issue func() (Credential, error)) (Guest, error)
	EnsureAdminInvitation(context.Context, *string, func() (Credential, error)) error
	RenewInvitation(context.Context, int64, func() (Credential, error)) error
	Invitation(context.Context, string) (PendingInvitation, error)
	// ConsumeInvitation calls grant while the guest is locked, then consumes the
	// invitation and creates/prunes sessions in that same transaction.
	ConsumeInvitation(context.Context, string, func(PendingInvitation) (SessionGrant, error)) (Guest, error)
	Revoke(context.Context, int64) error
	// Delete removes a revoked guest and their private records in one
	// transaction, keeping their messages, media and questions without author.
	Delete(context.Context, int64) error
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

// internationalPhone is E.164: a country code and at most 15 digits.
var internationalPhone = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

// NormalizePhone keeps the digits of an international number written with
// spaces, dots, dashes, slashes or brackets, and a leading + or 00. An empty
// number is none.
func NormalizePhone(phone string) (*string, error) {
	phone = strings.Map(func(r rune) rune {
		if strings.ContainsRune(" \t.-/()\u00a0", r) {
			return -1
		}
		return r
	}, phone)
	if phone == "" {
		return nil, nil
	}
	if rest, ok := strings.CutPrefix(phone, "00"); ok {
		phone = "+" + rest
	}
	if !internationalPhone.MatchString(phone) {
		return nil, ErrInvalidPhone
	}
	return &phone, nil
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
func (s *Service) Create(ctx context.Context, name, phone string, now func() time.Time) (Guest, Invitation, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Guest{}, Invitation{}, err
	}
	number, err := NormalizePhone(phone)
	if err != nil {
		return Guest{}, Invitation{}, err
	}
	var issued Invitation
	guest, err := s.repository.CreateGuest(ctx, name, number, func() (Credential, error) {
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

// Update renames a guest and changes the number their invitation is sent to;
// an empty number removes it. A new number for a guest with access replaces
// their invitation, since the old link may have gone to another phone. The
// returned invitation is nil when no link was issued.
func (s *Service) Update(ctx context.Context, id int64, name, phone string, now func() time.Time) (Guest, *Invitation, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Guest{}, nil, err
	}
	number, err := NormalizePhone(phone)
	if err != nil {
		return Guest{}, nil, err
	}
	var issued *Invitation
	guest, err := s.repository.UpdateGuest(ctx, id, name, number, func() (Credential, error) {
		invitation, credential, err := s.issueInvitation(now())
		issued = &invitation
		return credential, err
	})
	if err != nil {
		return Guest{}, nil, err
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

// Delete permanently removes a guest whose access was already removed.
func (s *Service) Delete(ctx context.Context, id, viewerID int64) error {
	if id == viewerID {
		return ErrSelfRevoke
	}
	return s.repository.Delete(ctx, id)
}
