package app

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"birthday-party/backend/internal/access"
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	guestidentity "birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

// The welcome access rule exists twice: welcome.HasAccess decides inside write
// transactions and pgwelcome.AccessSQL decides in single-statement reads. They
// must agree for every state, or a guest could read what they may not change.
func TestWelcomeAccessRuleMatchesItsSQLTwin(t *testing.T) {
	a := testApp(t)
	hostCookie, host := admin(t, a)
	visitorCookie, visitor, _ := guest(t, a, hostCookie, "Matrix guest")
	if _, err := a.db.Exec(`UPDATE welcome SET current_step=2,
 steps='[{"widgets":[{"type":"title","text":"One"}]},{"widgets":[{"type":"title","text":"Two"}]}]'::jsonb WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	const currentRun, previousRun = 3, 2
	progresses := []*welcome.Progress{nil}
	for _, generation := range []int64{currentRun, previousRun} {
		for _, position := range []int{0, 1, 2} {
			for _, completed := range []bool{false, true} {
				progresses = append(progresses, &welcome.Progress{Generation: generation, Position: position, Completed: completed})
			}
		}
	}
	viewers := []struct {
		cookie *http.Cookie
		guest  guestidentity.Guest
	}{{hostCookie, host}, {visitorCookie, visitor}}

	cases := 0
	for _, open := range []bool{false, true} {
		for _, required := range []bool{false, true} {
			for _, generation := range []int64{0, currentRun} {
				state := welcome.State{Open: open, Required: required, Generation: generation}
				if _, err := a.db.Exec("UPDATE welcome SET is_open=$1,required=$2,generation=$3 WHERE id=1", open, required, generation); err != nil {
					t.Fatal(err)
				}
				for _, stored := range progresses {
					for _, viewer := range viewers {
						cases++
						var progress welcome.Progress
						if _, err := a.db.Exec("DELETE FROM guest_welcome_progress WHERE guest_id=$1", viewer.guest.ID); err != nil {
							t.Fatal(err)
						}
						if stored != nil {
							progress = *stored
							if _, err := a.db.Exec("INSERT INTO guest_welcome_progress(guest_id,generation,position,completed) VALUES($1,$2,$3,$4)",
								viewer.guest.ID, progress.Generation, progress.Position, progress.Completed); err != nil {
								t.Fatal(err)
							}
						}
						name := fmt.Sprintf("role=%s state=%+v progress=%+v", viewer.guest.Role, state, stored)
						rule := welcome.HasAccess(state, progress)

						var twin bool
						err := a.db.QueryRow(`SELECT `+pgwelcome.AccessSQL+` FROM welcome w
 LEFT JOIN guest_welcome_progress p ON p.guest_id=$1 WHERE w.id=1`, viewer.guest.ID).Scan(&twin)
						if err != nil || twin != rule {
							t.Fatalf("%s: AccessSQL=%v HasAccess=%v error=%v", name, twin, rule, err)
						}

						// Administrators bypass the rule in both the HTTP and realtime checks.
						want := viewer.guest.IsAdmin() || rule
						_, err = a.access.Authorize(t.Context(), viewer.cookie.Value, access.Request{Scope: access.Party}, a.now())
						if granted := err == nil; granted != want || err != nil && !errors.Is(err, access.ErrWelcome) {
							t.Fatalf("%s: party access granted=%v want=%v error=%v", name, granted, want, err)
						}
						_, realtime, err := a.access.Realtime(t.Context(), guestidentity.HashToken(viewer.cookie.Value), viewer.guest.ID, a.now())
						if err != nil || realtime != want {
							t.Fatalf("%s: realtime programme access=%v want=%v error=%v", name, realtime, want, err)
						}
					}
				}
			}
		}
	}
	if want := 2 * 2 * 2 * len(progresses) * len(viewers); cases != want {
		t.Fatalf("checked %d combinations, want %d", cases, want)
	}
}
