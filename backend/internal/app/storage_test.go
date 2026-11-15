package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUploadsAreRefusedBeforeFillingTheDisk(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	diskWithRoom(a, 20<<30, defaultKeepFree(20<<30)+64<<20)
	status(t, queuedUpload(t, a, host, "", pngBytes(t)), 202)
	// Only the reserve is left: the next file is refused before it is read.
	diskWithRoom(a, 20<<30, defaultKeepFree(20<<30))
	r, body := uploadRequest(t, host, "", pngBytes(t))
	unread := body.Len()
	refused := httptest.NewRecorder()
	a.Handler().ServeHTTP(refused, r)
	status(t, refused, 409)
	if !strings.Contains(refused.Body.String(), `"storage_full"`) || body.Len() != unread {
		t.Fatalf("full disk answered %s after reading %d bytes", refused.Body.String(), unread-body.Len())
	}
}

func TestStorageReportIsForAdministrators(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Curious guest")
	diskWithRoom(a, 100<<30, 15<<30)
	status(t, request(t, a, "GET", "/api/admin/storage", nil, visitor), 403)
	report := request(t, a, "GET", "/api/admin/storage", nil, host)
	status(t, report, 200)
	if body := strings.TrimSpace(report.Body.String()); body != `{"availableBytes":16106127360,"totalBytes":107374182400,"warning":true}` {
		t.Fatalf("storage report %s", body)
	}
}

func storageAlerts(t *testing.T, a *App) []string {
	t.Helper()
	rows, err := a.db.Query("SELECT kind FROM storage_notification_outbox ORDER BY kind")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, kind)
	}
	return kinds
}

func clearStorageAlerts(t *testing.T, a *App) {
	t.Helper()
	if _, err := a.db.Exec("DELETE FROM storage_notification_outbox"); err != nil {
		t.Fatal(err)
	}
}

func TestStorageAlertsReachAdministratorsOncePerEpisode(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Guest with notifications")
	status(t, request(t, a, "PUT", "/api/notifications/subscription", testNotificationInput(t), host), 200)
	guestDevice := testNotificationInput(t)
	guestDevice.Endpoint += "-guest"
	status(t, request(t, a, "PUT", "/api/notifications/subscription", guestDevice, visitor), 200)
	const total = 100 << 30
	for _, step := range []struct {
		usedPercent int64
		want        string
	}{
		{70, ""},
		{85, "storage_warning"},
		{90, ""}, // Still in the warning range: no second alert.
		{78, ""}, // Below the line but not far enough to warn again.
		{60, ""},
		{82, "storage_warning"},
	} {
		diskWithRoom(a, total, total*(100-step.usedPercent)/100)
		a.watchStorage(t.Context())
		if got := strings.Join(storageAlerts(t, a), ","); got != step.want {
			t.Fatalf("at %d%% used, queued %q want %q", step.usedPercent, got, step.want)
		}
		clearStorageAlerts(t, a)
	}

	diskWithRoom(a, total, 0)
	for range 2 {
		status(t, queuedUpload(t, a, host, "", pngBytes(t)), 409)
	}
	if got := strings.Join(storageAlerts(t, a), ","); got != "storage_full" {
		t.Fatalf("refusals queued %q", got)
	}
	clearStorageAlerts(t, a)
	status(t, queuedUpload(t, a, host, "", pngBytes(t)), 409)
	if len(storageAlerts(t, a)) != 0 {
		t.Fatal("refusals within the hour repeated the alert")
	}
	later := a.now().Add(time.Hour)
	a.now = func() time.Time { return later }
	status(t, queuedUpload(t, a, host, "", pngBytes(t)), 409)

	topics := []string{}
	a.notificationSender.Client = notificationHTTPFunc(func(r *http.Request) (*http.Response, error) {
		topics = append(topics, r.Header.Get("Topic")+" "+r.Header.Get("TTL"))
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if processed, err := a.notifications.ProcessNext(t.Context()); err != nil || !processed {
		t.Fatalf("storage alert not delivered: %v", err)
	}
	if strings.Join(topics, ",") != "birthday-storage 43200" || len(storageAlerts(t, a)) != 0 {
		t.Fatalf("delivered %v, left %v", topics, storageAlerts(t, a))
	}
}
