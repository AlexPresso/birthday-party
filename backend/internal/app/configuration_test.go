package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/party"
)

func TestProductConfigurationEnvironmentPreservesEmptyOverrides(t *testing.T) {
	for _, name := range []string{"INVITATION_TITLE", "INVITATION_DESCRIPTION", "INVITATION_TITLE_EN", "INVITATION_DESCRIPTION_EN"} {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("BIRTHDAY_AGE", "42")
	t.Setenv("INVITATION_TITLE", "  Shared title  ")
	t.Setenv("INVITATION_TITLE_FR", "  ")
	configuration := productConfigurationFromEnv()
	if configuration.Age != 42 || *configuration.Invitation.Title != "Shared title" || configuration.Invitation.Description != nil || *configuration.Invitation.Locales["fr"].Title != "" || configuration.Invitation.Locales["en"].Title != nil {
		t.Fatalf("environment fallback semantics changed: %+v", configuration)
	}
	for _, value := range []string{"", "0", "151", "1.5", "invalid"} {
		t.Setenv("BIRTHDAY_AGE", value)
		if configuration := productConfigurationFromEnv(); configuration.Age != 30 {
			t.Fatalf("invalid age %q did not use the existing fallback", value)
		}
	}
}

func TestConfigurationAccessPersistenceAndPublicProjection(t *testing.T) {
	seed := party.DefaultConfiguration()
	seed.Age = 42
	title, empty := "Shared title", ""
	seed.Invitation.Title = &title
	seed.Invitation.Locales["fr"] = party.InvitationText{Title: &empty}
	config := Config{PublicURL: "http://localhost:3000", DataDir: t.TempDir(), DatabaseURL: testDatabaseURL(t), ProductConfiguration: seed, MaxImageBytes: 2 << 20, MaxVideoBytes: 5 << 20}
	a, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Visitor")
	public := request(t, a, "GET", "/api/config", nil, nil)
	status(t, public, 200)
	var exposed map[string]json.RawMessage
	if err := json.Unmarshal(public.Body.Bytes(), &exposed); err != nil {
		t.Fatal(err)
	}
	if len(exposed) != 2 || exposed["age"] == nil || exposed["invitation"] == nil {
		t.Fatalf("public configuration exposed unexpected fields: %s", public.Body.String())
	}
	status(t, request(t, a, "GET", "/api/admin/config", nil, nil), 401)
	status(t, request(t, a, "GET", "/api/admin/config", nil, visitor), 403)
	status(t, request(t, a, "PUT", "/api/admin/config", seed, visitor), 403)
	status(t, request(t, a, "PUT", "/api/admin/config", seed, nil), 401)
	read := request(t, a, "GET", "/api/admin/config", nil, host)
	status(t, read, 200)
	var saved party.Configuration
	if err := json.Unmarshal(read.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Age != 42 || saved.ImageSizeMB != 2 || saved.VideoSizeMB != 5 || *saved.Invitation.Locales["fr"].Title != "" || saved.Invitation.Description != nil {
		t.Fatalf("initial configuration was not imported: %+v", saved)
	}
	saved.Age, saved.ImageSizeMB, saved.VideoSizeMB = 43, 3, 7
	status(t, request(t, a, "PUT", "/api/admin/config", saved, host), 200)
	for _, endpoint := range []string{"/api/photos", "/api/profile"} {
		response := request(t, a, "GET", endpoint, nil, visitor)
		status(t, response, 200)
		if !strings.Contains(response.Body.String(), `"imageBytes":3145728`) {
			t.Fatalf("%s retained old upload limits: %s", endpoint, response.Body.String())
		}
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	config.ProductConfiguration.Age, config.MaxImageBytes = 999, -1
	config.ProductConfiguration.Invitation.Locales = nil
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.configuration.Get(t.Context())
	if err != nil || persisted.Age != 43 || persisted.ImageSizeMB != 3 || persisted.VideoSizeMB != 7 {
		t.Fatalf("restart overwrote saved settings: %+v %v", persisted, err)
	}
}

func TestConfigurationImportsLegacyCopyWithoutEditorLimits(t *testing.T) {
	title, description := strings.Repeat("é", 201), strings.Repeat("a", 2001)
	t.Setenv("INVITATION_TITLE", title)
	t.Setenv("INVITATION_DESCRIPTION_FR", description)
	config := Config{PublicURL: "http://localhost:3000", DataDir: t.TempDir(), DatabaseURL: testDatabaseURL(t), ProductConfiguration: productConfigurationFromEnv()}
	a, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	imported, err := a.configuration.Get(t.Context())
	if err != nil || imported.Invitation.Title == nil || *imported.Invitation.Title != title || imported.Invitation.Locales["fr"].Description == nil || *imported.Invitation.Locales["fr"].Description != description {
		t.Fatalf("legacy invitation content changed during import: %v", err)
	}
	host, _ := admin(t, a)
	status(t, request(t, a, "GET", "/api/config", nil, nil), 200)
	status(t, request(t, a, "PUT", "/api/admin/config", imported, host), 400)
	status(t, request(t, a, "PUT", "/api/admin/config", party.DefaultConfiguration(), host), 200)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	config.ProductConfiguration.Invitation.Title = &title
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.configuration.Get(t.Context())
	if err != nil || persisted.Invitation.Title != nil {
		t.Fatalf("obsolete long environment copy replaced persisted settings: %v", err)
	}
}

func TestConfigurationImportsValidateEnvironmentOnlyOnce(t *testing.T) {
	t.Setenv("DATABASE_URL", testDatabaseURL(t))
	t.Setenv("PUBLIC_URL", "http://localhost:3000")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("PRINT_ADMIN_INVITATION", "false")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("MAX_IMAGE_SIZE_MB", "invalid")
	t.Setenv("MAX_VIDEO_SIZE_MB", "100")
	invalidSeed, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if first, err := Open(invalidSeed); err == nil {
		first.Close()
		t.Fatal("invalid environment seed initialized an empty configuration")
	}
	t.Setenv("MAX_IMAGE_SIZE_MB", "2")
	validSeed, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	first, err := Open(validSeed)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(invalidSeed)
	if err != nil {
		t.Fatalf("unused invalid environment prevented reopening: %v", err)
	}
	defer reopened.Close()
	persisted, err := reopened.configuration.Get(t.Context())
	if err != nil || persisted.ImageSizeMB != 2 {
		t.Fatalf("obsolete invalid seed changed saved limits: %v", err)
	}
}

func TestConfigurationSaveRejectsSessionExpiringWhileWaitingForLocks(t *testing.T) {
	for _, lockTarget := range []string{"guest", "session", "configuration"} {
		t.Run(lockTarget, func(t *testing.T) {
			a := testApp(t)
			var current atomic.Int64
			current.Store(a.now().Unix())
			a.now = func() time.Time { return time.Unix(current.Load(), 0) }
			host, guest := admin(t, a)
			expires := current.Load() + 1
			if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", expires, identity.HashToken(host.Value)); err != nil {
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
			switch lockTarget {
			case "guest":
				err = lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&holder)
			case "session":
				err = lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM sessions WHERE token_hash=$1 FOR UPDATE", identity.HashToken(host.Value)).Scan(&holder)
			case "configuration":
				err = lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM product_configuration WHERE id=1 FOR UPDATE").Scan(&holder)
			}
			if err != nil {
				t.Fatal(err)
			}
			configuration := party.DefaultConfiguration()
			configuration.Age = 44
			body, err := json.Marshal(configuration)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("PUT", "/api/admin/config", bytes.NewReader(body)).WithContext(ctx)
			r.Header.Set("X-Requested-With", "birthday-party")
			r.AddCookie(host)
			response := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				result := httptest.NewRecorder()
				a.Handler().ServeHTTP(result, r)
				response <- result
			}()
			for {
				var blocked bool
				if err := a.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))", holder).Scan(&blocked); err != nil {
					t.Fatal(err)
				}
				if blocked {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("configuration save did not reach the held lock")
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
				t.Fatal("configuration save did not finish after the lock was released")
			}
			persisted, err := a.configuration.Get(t.Context())
			if err != nil || persisted.Age != 30 {
				t.Fatalf("expired session changed configuration: %v", err)
			}
		})
	}
}

func TestConfigurationRequiresCompleteValidInput(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	valid, err := json.Marshal(party.DefaultConfiguration())
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		`{}`,
		strings.Replace(string(valid), `"title":null,`, "", 1),
		strings.Replace(string(valid), `"en":`, `"nl":`, 1),
		strings.Replace(string(valid), `"age":30`, `"age":null`, 1),
		strings.Replace(string(valid), `"age":30`, `"age":151`, 1),
		strings.Replace(string(valid), `"imageSizeMB":15`, `"imageSizeMB":1.5`, 1),
		strings.Replace(string(valid), `"videoSizeMB":100`, `"videoSizeMB":1025`, 1),
		strings.Replace(string(valid), `"title":null`, `"title":true`, 1),
		strings.Replace(string(valid), `"title":null`, `"title":null,"extra":1`, 1),
	} {
		status(t, request(t, a, "PUT", "/api/admin/config", json.RawMessage(input), host), 400)
	}
	current, err := a.configuration.Get(t.Context())
	if err != nil || current.Age != 30 || current.ImageSizeMB != 15 || current.VideoSizeMB != 100 {
		t.Fatalf("invalid request changed configuration: %+v %v", current, err)
	}
}

func TestConfigurationRechecksAdministratorDuringSave(t *testing.T) {
	for _, action := range []string{"logout", "revoke", "demote"} {
		t.Run(action, func(t *testing.T) {
			a := testApp(t)
			host, guest := admin(t, a)
			configuration := party.DefaultConfiguration()
			configuration.Age = 44
			body, err := json.Marshal(configuration)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest("PUT", "/api/admin/config", bytes.NewReader(body))
			r.Header.Set("X-Requested-With", "birthday-party")
			r.AddCookie(host)
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch action {
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, host), 204)
				case "revoke":
					_, err = a.db.Exec("UPDATE guests SET active=0 WHERE id=$1", guest.ID)
				case "demote":
					_, err = a.db.Exec("UPDATE guests SET role='guest' WHERE id=$1", guest.ID)
				}
				if err != nil {
					t.Fatal(err)
				}
			}})
			response := httptest.NewRecorder()
			a.Handler().ServeHTTP(response, r)
			want := http.StatusUnauthorized
			if action == "demote" {
				want = http.StatusForbidden
			}
			status(t, response, want)
			current, err := a.configuration.Get(t.Context())
			if err != nil || current.Age != 30 {
				t.Fatalf("revoked administrator changed configuration: %+v %v", current, err)
			}
		})
	}
}

func TestConfigurationLimitChangesPreserveAcceptedUploads(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	configuration := party.DefaultConfiguration()
	configuration.ImageSizeMB = 2
	status(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 200)
	data := append(pngBytes(t), make([]byte, 1<<20)...)
	accepted := queuedUpload(t, a, host, "", data)
	status(t, accepted, 202)
	configuration.ImageSizeMB = 1
	status(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 200)
	status(t, queuedUpload(t, a, host, "", data), 413)
	status(t, uploadAvatar(t, a, host, data), 413)
	status(t, completeTestUpload(t, a, host, accepted), 201)
	configuration.ImageSizeMB = 2
	status(t, request(t, a, "PUT", "/api/admin/config", configuration, host), 200)
	status(t, queuedUpload(t, a, host, "", data), 202)
	status(t, uploadAvatar(t, a, host, data), 200)
}
