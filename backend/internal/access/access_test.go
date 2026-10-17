package access

import (
	"errors"
	"testing"

	"birthday-party/backend/internal/identity"
)

func TestWelcomeScopesOnlyGrantCurrentOwnCapabilities(t *testing.T) {
	guest := identity.Guest{ID: 12, Role: "guest", Active: true}
	for _, test := range []struct {
		name     string
		snapshot Snapshot
		request  Request
		want     error
	}{
		{"session during welcome", Snapshot{Guest: guest}, Request{Scope: Session}, nil},
		{"party during welcome", Snapshot{Guest: guest, ProfileWidget: true, MediaWidget: true}, Request{Scope: Party}, ErrWelcome},
		{"own current profile", Snapshot{Guest: guest, ProfileWidget: true}, Request{Scope: Profile, TargetGuestID: 12}, nil},
		{"other guest profile", Snapshot{Guest: guest, ProfileWidget: true}, Request{Scope: Profile, TargetGuestID: 13}, ErrWelcome},
		{"profile widget absent", Snapshot{Guest: guest}, Request{Scope: Profile}, ErrWelcome},
		{"current media widget", Snapshot{Guest: guest, MediaWidget: true}, Request{Scope: Upload}, nil},
		{"upload widget absent", Snapshot{Guest: guest}, Request{Scope: Upload}, ErrWelcome},
		{"open party", Snapshot{Guest: guest, Open: true}, Request{Scope: Party}, nil},
		{"guest cannot administer", Snapshot{Guest: guest, Open: true}, Request{Admin: true, Scope: Session}, ErrAdmin},
		{"revoked admin", Snapshot{Guest: identity.Guest{ID: 1, Role: "admin"}}, Request{Scope: Party}, ErrExpired},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := Check(test.snapshot, test.request); !errors.Is(err, test.want) {
				t.Fatalf("error=%v, want %v", err, test.want)
			}
		})
	}
}
