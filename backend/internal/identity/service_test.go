package identity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type memoryIdentities struct {
	pending     PendingInvitation
	credential  Credential
	grant       SessionGrant
	createdName string
	guestLimit  int
	lookupHash  string
	lookups     int
	consumed    bool
	revoked     bool
	beforeWrite func()
}

func (repository *memoryIdentities) List(context.Context, int) ([]Guest, error) {
	return []Guest{repository.pending.Guest}, nil
}

func (repository *memoryIdentities) CreateGuest(_ context.Context, name string, issue func() (Credential, error), limit int) (Guest, error) {
	if repository.beforeWrite != nil {
		repository.beforeWrite()
	}
	credential, err := issue()
	if err != nil {
		return Guest{}, err
	}
	repository.createdName, repository.credential, repository.guestLimit = name, credential, limit
	return Guest{ID: 17, Name: name, Role: "guest", Active: true}, nil
}

func (repository *memoryIdentities) EnsureAdminInvitation(_ context.Context, _ *string, issue func() (Credential, error)) error {
	if repository.beforeWrite != nil {
		repository.beforeWrite()
	}
	credential, err := issue()
	if err != nil {
		return err
	}
	repository.credential = credential
	return nil
}

func (repository *memoryIdentities) RenewInvitation(_ context.Context, _ int64, issue func() (Credential, error)) error {
	if repository.beforeWrite != nil {
		repository.beforeWrite()
	}
	credential, err := issue()
	if err != nil {
		return err
	}
	repository.credential = credential
	return nil
}

func (repository *memoryIdentities) Invitation(_ context.Context, hash string) (PendingInvitation, error) {
	repository.lookupHash, repository.lookups = hash, repository.lookups+1
	return repository.pending, nil
}

func (repository *memoryIdentities) ConsumeInvitation(_ context.Context, hash string, authorize func(PendingInvitation) (SessionGrant, error)) (Guest, error) {
	repository.lookupHash, repository.lookups = hash, repository.lookups+1
	if repository.beforeWrite != nil {
		repository.beforeWrite()
	}
	grant, err := authorize(repository.pending)
	if err != nil {
		return Guest{}, err
	}
	repository.grant, repository.consumed, repository.pending.Used = grant, true, true
	return repository.pending.Guest, nil
}

func (repository *memoryIdentities) Revoke(context.Context, int64) error {
	repository.revoked = true
	return nil
}
func (repository *memoryIdentities) Logout(context.Context, string) error { return nil }

func TestServiceChecksInvitationAvailabilityBeforePreviewAndConsumption(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	token, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name         string
		active, used bool
		expires      time.Time
		want         error
	}{
		{"available", true, false, now.Add(time.Second), nil},
		{"expiry boundary", true, false, now, ErrUnavailableInvitation},
		{"expired", true, false, now.Add(-time.Second), ErrUnavailableInvitation},
		{"used", true, true, now.Add(time.Hour), ErrUnavailableInvitation},
		{"revoked", false, false, now.Add(time.Hour), ErrUnavailableInvitation},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &memoryIdentities{pending: PendingInvitation{Guest: Guest{ID: 17, Name: "Camille", Role: "guest", Active: test.active}, Used: test.used, ExpiresAt: test.expires}}
			service := New(repository, "https://party.example")
			preview, err := service.PreviewInvitation(t.Context(), token, now)
			if !errors.Is(err, test.want) {
				t.Fatalf("preview error=%v want=%v", err, test.want)
			}
			if test.want == nil && preview.GuestName != "Camille" {
				t.Fatalf("preview=%+v", preview)
			}
			session, err := service.AcceptInvitation(t.Context(), token, func() time.Time { return now })
			if !errors.Is(err, test.want) || repository.consumed != (test.want == nil) {
				t.Fatalf("consumed=%v error=%v want=%v", repository.consumed, err, test.want)
			}
			if repository.lookupHash != HashToken(token) {
				t.Fatal("raw invitation token reached persistence")
			}
			if test.want == nil {
				if !ValidToken(session.Token) || session.Token == token || session.Guest.ID != 17 || !session.ExpiresAt.Equal(now.Add(SessionTTL)) {
					t.Fatalf("session identity or lifetime is incorrect")
				}
				if repository.grant.Credential.TokenHash != HashToken(session.Token) || repository.grant.SessionLimit != 5 || !repository.grant.CreatedAt.Equal(now) || !repository.grant.Credential.ExpiresAt.Equal(session.ExpiresAt) {
					t.Fatal("session grant lost the digest, bounded session policy or expiry")
				}
				if _, err := service.AcceptInvitation(t.Context(), token, func() time.Time { return now }); !errors.Is(err, ErrUnavailableInvitation) {
					t.Fatalf("reused invitation error=%v", err)
				}
			}
		})
	}
}

func TestServiceRejectsMalformedCredentialsWithoutPersistence(t *testing.T) {
	repository := &memoryIdentities{}
	service := New(repository, "https://party.example")
	if _, err := service.PreviewInvitation(t.Context(), "invalid", time.Now()); !errors.Is(err, ErrInvalidInvitation) {
		t.Fatalf("preview error=%v", err)
	}
	if _, err := service.AcceptInvitation(t.Context(), "invalid", time.Now); !errors.Is(err, ErrInvalidInvitation) {
		t.Fatalf("accept error=%v", err)
	}
	if repository.lookups != 0 {
		t.Fatal("malformed credentials reached persistence")
	}
}

func TestServiceIssuesPrivateHashedInvitationsAndBoundsGuests(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 123, time.UTC)
	repository := &memoryIdentities{}
	service := New(repository, "https://party.example")
	if _, _, err := service.Create(t.Context(), " \t", func() time.Time { return now }); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("invalid name error=%v", err)
	}
	if repository.createdName != "" {
		t.Fatal("invalid name reached persistence")
	}
	guest, issued, err := service.Create(t.Context(), "  Camille  ", func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	token := strings.TrimPrefix(issued.InvitationURL, "https://party.example/invitation#token=")
	if guest.Name != "Camille" || repository.createdName != guest.Name || repository.guestLimit != 500 || !ValidToken(token) {
		t.Fatal("guest creation lost normalization, capacity or invitation encoding")
	}
	if repository.credential.TokenHash != HashToken(token) || !repository.credential.ExpiresAt.Equal(now.Add(InvitationTTL)) || issued.ExpiresAt != now.Add(InvitationTTL).Format(time.RFC3339Nano) {
		t.Fatal("invitation persistence lost the digest or expiry")
	}
	if err := service.Revoke(t.Context(), guest.ID, guest.ID); !errors.Is(err, ErrSelfRevoke) || repository.revoked {
		t.Fatalf("self revoke reached persistence: error=%v", err)
	}
}

func TestInvitationIssuanceStartsLifetimeAfterPersistenceWait(t *testing.T) {
	for _, test := range []struct {
		name  string
		issue func(*Service, func() time.Time) error
	}{
		{"guest creation", func(service *Service, clock func() time.Time) error {
			_, _, err := service.Create(t.Context(), "Camille", clock)
			return err
		}},
		{"startup administrator", func(service *Service, clock func() time.Time) error {
			_, err := service.StartupAdminInvitation(t.Context(), clock)
			return err
		}},
		{"named administrator", func(service *Service, clock func() time.Time) error {
			_, err := service.InviteAdmin(t.Context(), "Camille", clock)
			return err
		}},
		{"renewal", func(service *Service, clock func() time.Time) error {
			_, err := service.RenewInvitation(t.Context(), 17, clock)
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
			afterWait := now.Add(time.Minute)
			repository := &memoryIdentities{beforeWrite: func() { now = afterWait }}
			if err := test.issue(New(repository, "https://party.example"), func() time.Time { return now }); err != nil {
				t.Fatal(err)
			}
			if !repository.credential.ExpiresAt.Equal(afterWait.Add(InvitationTTL)) {
				t.Fatalf("expiry=%v, want lifetime to start after lock wait", repository.credential.ExpiresAt)
			}
		})
	}
}

func TestInvitationConsumptionChecksExpiryAfterPersistenceWait(t *testing.T) {
	started := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	token, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		expires time.Time
		want    error
	}{
		{"expires during lock wait", started.Add(time.Second), ErrUnavailableInvitation},
		{"still valid after lock wait", started.Add(time.Hour), nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			now := started
			afterWait := started.Add(time.Minute)
			repository := &memoryIdentities{pending: PendingInvitation{Guest: Guest{ID: 17, Active: true}, ExpiresAt: test.expires}, beforeWrite: func() { now = afterWait }}
			session, err := New(repository, "https://party.example").AcceptInvitation(t.Context(), token, func() time.Time { return now })
			if !errors.Is(err, test.want) || repository.consumed != (test.want == nil) {
				t.Fatalf("consumed=%v error=%v want=%v", repository.consumed, err, test.want)
			}
			if test.want == nil && (!session.ExpiresAt.Equal(afterWait.Add(SessionTTL)) || !repository.grant.CreatedAt.Equal(afterWait)) {
				t.Fatal("session lifetime or pruning used the time before lock acquisition")
			}
		})
	}
}
