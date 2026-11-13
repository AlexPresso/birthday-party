package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	guestidentity "birthday-party/backend/internal/identity"
)

func TestConcurrentStartupKeepsOneAdministrator(t *testing.T) {
	a := testApp(t)
	var tasks sync.WaitGroup
	errors := make(chan error, 4)
	for range 4 {
		tasks.Go(func() {
			_, err := a.StartupAdminInvitation(t.Context())
			errors <- err
		})
	}
	tasks.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var guests, invitations int
	if err := a.db.QueryRow("SELECT (SELECT COUNT(*) FROM guests),(SELECT COUNT(*) FROM invitations)").Scan(&guests, &invitations); err != nil {
		t.Fatal(err)
	}
	if guests != 1 || invitations != 1 {
		t.Fatalf("concurrent startup created duplicate records: guests=%d invitations=%d", guests, invitations)
	}
}

func TestStartupAdminInvitationCreatesAdministrator(t *testing.T) {
	a := testApp(t)
	link, err := a.StartupAdminInvitation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(link, a.config.PublicURL+"/invitation#token=") {
		t.Fatal("invitation does not use the configured public URL")
	}
	token := tokenFromURL(t, link)
	if !guestidentity.ValidToken(token) {
		t.Fatal("startup invitation has an invalid token")
	}
	var stored string
	var expires time.Time
	if err := a.db.QueryRow("SELECT token_hash,expires_at FROM invitations").Scan(&stored, &expires); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != guestidentity.HashToken(token) {
		t.Fatal("startup invitation token must only be stored hashed")
	}
	if !expires.Equal(a.now().Add(guestidentity.InvitationTTL)) {
		t.Fatal("startup invitation does not use the standard expiry")
	}
	accepted := request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil)
	status(t, accepted, http.StatusOK)
	var result struct {
		Guest guestidentity.Guest `json:"guest"`
	}
	if err := json.Unmarshal(accepted.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Guest.Name != "Admin" || result.Guest.Role != "admin" || !result.Guest.Active {
		t.Fatalf("unexpected startup identity: %+v", result.Guest)
	}
	status(t, request(t, a, "GET", "/api/admin/guests", nil, accepted.Result().Cookies()[0]), http.StatusOK)
	status(t, request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil), http.StatusUnauthorized)
}

func TestStartupAdminInvitationPreservesIdentityAndSession(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	first, err := a.StartupAdminInvitation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.StartupAdminInvitation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("startup reused the previous invitation token")
	}
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": tokenFromURL(t, first)}, nil), http.StatusUnauthorized)
	status(t, request(t, a, "GET", "/api/session", nil, host), http.StatusOK)
	accepted := request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, second)}, nil)
	status(t, accepted, http.StatusOK)
	var result struct {
		Guest guestidentity.Guest `json:"guest"`
	}
	if err := json.Unmarshal(accepted.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Guest != identity {
		t.Fatalf("startup changed the administrator identity: got %+v, want %+v", result.Guest, identity)
	}
	status(t, request(t, a, "GET", "/api/admin/guests", nil, host), http.StatusOK)
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM guests").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("startup created duplicate administrators: guest count=%d", count)
	}
}

func TestStartupAdminInvitationSelectsOnlyActiveAdministrators(t *testing.T) {
	for _, test := range []struct {
		name   string
		guests []guestidentity.Guest
		wantID int64
	}{
		{
			name: "oldest active administrator",
			guests: []guestidentity.Guest{
				{ID: 1, Name: "Admin", Role: "guest", Active: true},
				{ID: 2, Name: "Former host", Role: "admin", Active: false},
				{ID: 3, Name: "Camille", Role: "admin", Active: true},
				{ID: 4, Name: "Alex", Role: "admin", Active: true},
			},
			wantID: 3,
		},
		{
			name: "guest named Admin is not promoted",
			guests: []guestidentity.Guest{
				{ID: 1, Name: "Admin", Role: "guest", Active: true},
			},
			wantID: 2,
		},
		{
			name: "revoked administrator is not reactivated",
			guests: []guestidentity.Guest{
				{ID: 1, Name: "Admin", Role: "admin", Active: false},
			},
			wantID: 2,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := testApp(t)
			for _, guest := range test.guests {
				if _, err := a.db.Exec("INSERT INTO guests(name,role,active) VALUES($1,$2,$3)", guest.Name, guest.Role, guest.Active); err != nil {
					t.Fatal(err)
				}
			}
			link, err := a.StartupAdminInvitation(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			var id int64
			if err := a.db.QueryRow("SELECT guest_id FROM invitations WHERE token_hash=$1", guestidentity.HashToken(tokenFromURL(t, link))).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if id != test.wantID {
				t.Fatalf("invitation guest ID=%d, want %d", id, test.wantID)
			}
			for _, original := range test.guests {
				var stored guestidentity.Guest
				if err := a.db.QueryRow("SELECT id,name,role,active FROM guests WHERE id=$1", original.ID).Scan(&stored.ID, &stored.Name, &stored.Role, &stored.Active); err != nil {
					t.Fatal(err)
				}
				if stored != original {
					t.Fatalf("startup modified an existing guest: got %+v, want %+v", stored, original)
				}
			}
		})
	}
}

func TestPrintAdminInvitationConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://unused/unused")
	t.Setenv("PUBLIC_URL", "http://localhost:3000")
	t.Setenv("COOKIE_SECURE", "false")
	for _, test := range []struct {
		name    string
		value   *string
		want    bool
		wantErr bool
	}{
		{name: "absent"},
		{name: "enabled", value: ptr("true"), want: true},
		{name: "disabled", value: ptr("false")},
		{name: "invalid", value: ptr("yes"), wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PRINT_ADMIN_INVITATION", "")
			if test.value == nil {
				if err := os.Unsetenv("PRINT_ADMIN_INVITATION"); err != nil {
					t.Fatal(err)
				}
			} else {
				t.Setenv("PRINT_ADMIN_INVITATION", *test.value)
			}
			config, err := ConfigFromEnv()
			if test.wantErr {
				if err == nil || !strings.Contains(err.Error(), "PRINT_ADMIN_INVITATION") {
					t.Fatalf("expected a PRINT_ADMIN_INVITATION configuration error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if config.PrintAdminInvitation != test.want {
				t.Fatalf("PrintAdminInvitation=%t, want %t", config.PrintAdminInvitation, test.want)
			}
		})
	}
}
