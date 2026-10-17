package profile

import (
	"errors"
	"testing"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

func TestProfileMutationRequiresCurrentAccess(t *testing.T) {
	guest := identity.Guest{ID: 4, Role: "guest", Active: true}
	if err := CanEdit(guest, welcome.View{}); !errors.Is(err, ErrWelcome) {
		t.Fatalf("closed welcome error=%v", err)
	}
	view := welcome.View{Step: &welcome.VisibleStep{Widgets: []welcome.Widget{{Type: "profile_photo"}}}}
	if err := CanEdit(guest, view); err != nil {
		t.Fatal(err)
	}
	guest.Active = false
	if err := CanEdit(guest, view); !errors.Is(err, ErrRevoked) {
		t.Fatalf("revoked identity error=%v", err)
	}
}
