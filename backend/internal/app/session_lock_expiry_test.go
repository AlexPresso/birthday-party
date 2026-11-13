package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"birthday-party/backend/internal/identity"
)

func TestProfileAndNotificationWritesRejectSessionsExpiringWhileWaitingForGuestLock(t *testing.T) {
	for _, operation := range []string{"remove profile photo", "register notification"} {
		t.Run(operation, func(t *testing.T) {
			a := testApp(t)
			var current atomic.Int64
			current.Store(a.now().Unix())
			a.now = func() time.Time { return time.Unix(current.Load(), 0) }
			host, _ := admin(t, a)
			visitor, guest, _ := guest(t, a, host, "Waiting writer")
			profileGuest(t, uploadAvatar(t, a, visitor, pngBytes(t)))
			var original []byte
			var version int64
			if err := a.db.QueryRow("SELECT avatar_jpeg,avatar_version FROM guests WHERE id=$1", guest.ID).Scan(&original, &version); err != nil {
				t.Fatal(err)
			}
			expires := current.Load() + 1
			if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", time.Unix(expires, 0), identity.HashToken(visitor.Value)); err != nil {
				t.Fatal(err)
			}

			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			lock, err := a.db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Rollback()
			var holder int
			if err := lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&holder); err != nil {
				t.Fatal(err)
			}

			method, path := http.MethodDelete, "/api/profile/avatar"
			var body []byte
			if operation == "register notification" {
				method, path = http.MethodPut, "/api/notifications/subscription"
				body, err = json.Marshal(testNotificationInput(t))
				if err != nil {
					t.Fatal(err)
				}
			}
			request := httptest.NewRequest(method, path, bytes.NewReader(body)).WithContext(ctx)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Requested-With", "birthday-party")
			request.AddCookie(visitor)
			response := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				recorder := httptest.NewRecorder()
				a.Handler().ServeHTTP(recorder, request)
				response <- recorder
			}()

			// Observe actual database contention before advancing the clock. HTTP
			// authentication has already succeeded; the save must check time again.
			for {
				var blocked bool
				err = a.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))", holder).Scan(&blocked)
				if err != nil {
					t.Fatal(err)
				}
				if blocked {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("request did not reach the guest lock")
				case <-time.After(5 * time.Millisecond):
				}
			}
			current.Store(expires)
			if err := lock.Rollback(); err != nil {
				t.Fatal(err)
			}
			select {
			case result := <-response:
				assertWelcomeError(t, result, http.StatusUnauthorized, "session_expired")
			case <-ctx.Done():
				t.Fatal("request did not finish after the lock was released")
			}

			var saved []byte
			var savedVersion int64
			if err := a.db.QueryRow("SELECT avatar_jpeg,avatar_version FROM guests WHERE id=$1", guest.ID).Scan(&saved, &savedVersion); err != nil {
				t.Fatal(err)
			}
			if savedVersion != version || !bytes.Equal(saved, original) {
				t.Fatal("expired session changed the existing profile photo")
			}
			var subscriptions int
			if err := a.db.QueryRow("SELECT COUNT(*) FROM notification_subscriptions WHERE guest_id=$1", guest.ID).Scan(&subscriptions); err != nil || subscriptions != 0 {
				t.Fatalf("expired session registered a subscription: count=%d error=%v", subscriptions, err)
			}
		})
	}
}
