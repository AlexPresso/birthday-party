package identity

import (
	"context"
	"time"

	"birthday-party/backend/internal/timestamp"
)

// Invitation is the single-use link returned to the host.
type Invitation struct {
	InvitationURL string `json:"invitationUrl"`
	ExpiresAt     string `json:"expiresAt"`
}

// Preview contains only the identity and expiry shown before accepting a link.
type Preview struct {
	GuestName string `json:"guestName"`
	ExpiresAt string `json:"expiresAt"`
}

// Credential contains only the digest and expiry persisted for a secret token.
type Credential struct {
	TokenHash string
	ExpiresAt time.Time
}

// PendingInvitation is private state checked before preview or session issuance.
type PendingInvitation struct {
	Guest     Guest
	ExpiresAt time.Time
	Used      bool
}

func (invitation PendingInvitation) available(now time.Time) bool {
	return invitation.Guest.Active && !invitation.Used && invitation.ExpiresAt.After(now)
}

func (s *Service) issueInvitation(now time.Time) (Invitation, Credential, error) {
	token, err := NewToken()
	if err != nil {
		return Invitation{}, Credential{}, err
	}
	expires := now.Add(InvitationTTL)
	return Invitation{InvitationURL: s.publicURL + "/invitation#token=" + token, ExpiresAt: timestamp.Format(expires)},
		Credential{TokenHash: HashToken(token), ExpiresAt: expires}, nil
}

// StartupAdminInvitation reuses the oldest active administrator without changing sessions.
func (s *Service) StartupAdminInvitation(ctx context.Context, now func() time.Time) (string, error) {
	var issued Invitation
	if err := s.repository.EnsureAdminInvitation(ctx, nil, func() (Credential, error) {
		var credential Credential
		var err error
		issued, credential, err = s.issueInvitation(now())
		return credential, err
	}); err != nil {
		return "", err
	}
	return issued.InvitationURL, nil
}

// InviteAdmin is reserved for local commands; it preserves an existing active identity.
func (s *Service) InviteAdmin(ctx context.Context, name string, now func() time.Time) (string, error) {
	name, err := normalizeName(name)
	if err != nil {
		return "", err
	}
	var issued Invitation
	if err := s.repository.EnsureAdminInvitation(ctx, &name, func() (Credential, error) {
		var credential Credential
		var err error
		issued, credential, err = s.issueInvitation(now())
		return credential, err
	}); err != nil {
		return "", err
	}
	return issued.InvitationURL, nil
}

// PreviewInvitation checks a link without consuming it.
func (s *Service) PreviewInvitation(ctx context.Context, token string, now time.Time) (Preview, error) {
	if !ValidToken(token) {
		return Preview{}, ErrInvalidInvitation
	}
	invitation, err := s.repository.Invitation(ctx, HashToken(token))
	if err != nil {
		return Preview{}, err
	}
	if !invitation.available(now) {
		return Preview{}, ErrUnavailableInvitation
	}
	return Preview{GuestName: invitation.Guest.Name, ExpiresAt: timestamp.Format(invitation.ExpiresAt)}, nil
}

// RenewInvitation reactivates the same identity and replaces its unused invitation.
func (s *Service) RenewInvitation(ctx context.Context, id int64, now func() time.Time) (Invitation, error) {
	var issued Invitation
	if err := s.repository.RenewInvitation(ctx, id, func() (Credential, error) {
		var credential Credential
		var err error
		issued, credential, err = s.issueInvitation(now())
		return credential, err
	}); err != nil {
		return Invitation{}, err
	}
	return issued, nil
}
