package app

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	pgnotifications "birthday-party/backend/internal/adapters/postgres/notifications"
	push "birthday-party/backend/internal/adapters/webpush"
	guestidentity "birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/notifications"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type notificationInput struct {
	Endpoint string       `json:"endpoint"`
	Keys     webpush.Keys `json:"keys"`
	Locale   string       `json:"locale"`
}

func testNotificationInput(t *testing.T) notificationInput {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return notificationInput{
		Endpoint: "https://push.example.invalid/subscription",
		Keys: webpush.Keys{
			P256dh: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
			Auth:   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		}, Locale: "fr",
	}
}

func notificationSubscribed(t *testing.T, a *App, cookie *http.Cookie, endpoint string) bool {
	t.Helper()
	response := request(t, a, "POST", "/api/notifications/status", map[string]string{"endpoint": endpoint}, cookie)
	status(t, response, 200)
	var value struct{ Subscribed bool }
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	return value.Subscribed
}

func TestNotificationsKeysAndSubscriptionIdentity(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First notification guest")
	second, _, _ := guest(t, a, host, "Second notification guest")
	input := testNotificationInput(t)
	status(t, request(t, a, "GET", "/api/notifications", nil, nil), 401)
	response := request(t, a, "GET", "/api/notifications", nil, first)
	status(t, response, 200)
	var fields map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &fields); err != nil || len(fields) != 1 || fields["publicKey"] != a.notificationKeys.Public {
		t.Fatal("notification configuration must expose only the public key")
	}
	stored, err := pgnotifications.New(a.db, a.now).LoadKeys(t.Context(), push.GenerateKeys)
	if err != nil || stored != a.notificationKeys {
		t.Fatal("notification keys changed after initialization")
	}
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, first), 200)
	if !notificationSubscribed(t, a, first, input.Endpoint) || notificationSubscribed(t, a, second, input.Endpoint) {
		t.Fatal("subscription status crossed session ownership")
	}
	status(t, request(t, a, "DELETE", "/api/notifications/subscription", inputEndpoint(input), second), 204)
	if !notificationSubscribed(t, a, first, input.Endpoint) {
		t.Fatal("another identity removed a subscription")
	}
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, second), 200)
	if notificationSubscribed(t, a, first, input.Endpoint) || !notificationSubscribed(t, a, second, input.Endpoint) {
		t.Fatal("explicit activation did not transfer the shared-browser subscription")
	}
	status(t, request(t, a, "POST", "/api/logout", nil, first), 204)
	if !notificationSubscribed(t, a, second, input.Endpoint) {
		t.Fatal("the previous session removed the new identity's subscription")
	}
	status(t, request(t, a, "POST", "/api/logout", nil, second), 204)
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM notification_subscriptions").Scan(&count); err != nil || count != 0 {
		t.Fatal("logout did not remove its notification subscription")
	}
}

func inputEndpoint(input notificationInput) map[string]string {
	return map[string]string{"endpoint": input.Endpoint}
}

func TestNotificationsValidateAndBoundSubscriptions(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	input := testNotificationInput(t)
	for _, test := range []struct {
		name string
		edit func(*notificationInput)
	}{
		{"HTTP endpoint", func(i *notificationInput) { i.Endpoint = "http://push.example.invalid/path" }},
		{"private endpoint", func(i *notificationInput) { i.Endpoint = "https://127.0.0.1/path" }},
		{"invalid public key", func(i *notificationInput) { i.Keys.P256dh = "invalid" }},
		{"off-curve public key", func(i *notificationInput) { i.Keys.P256dh = base64.RawURLEncoding.EncodeToString(make([]byte, 65)) }},
		{"invalid authentication secret", func(i *notificationInput) { i.Keys.Auth = "invalid" }},
		{"unsupported locale", func(i *notificationInput) { i.Locale = "fr-CH" }},
		{"missing locale", func(i *notificationInput) { i.Locale = "" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			invalid := input
			test.edit(&invalid)
			assertWelcomeError(t, request(t, a, "PUT", "/api/notifications/subscription", invalid, host), 400, "invalid_notification_subscription")
		})
	}
	for index := range 10 {
		input.Endpoint = "https://push.example.invalid/device/" + strconv.Itoa(index)
		status(t, request(t, a, "PUT", "/api/notifications/subscription", input, host), 200)
	}
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, host), 200)
	input.Endpoint = "https://push.example.invalid/one-too-many"
	assertWelcomeError(t, request(t, a, "PUT", "/api/notifications/subscription", input, host), 409, "notification_subscription_limit")
}

func TestNotificationsRespectSelectedWelcomeWidget(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Notification participant")
	steps := []welcomeStep{testWelcomeStep("First", ""), {Widgets: []welcomeWidget{{Type: "enable_notifications"}}}, testWelcomeStep("Third", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	readGuestWelcome(t, a, visitor)
	input := testNotificationInput(t)
	status(t, request(t, a, "GET", "/api/notifications", nil, visitor), 200)
	status(t, request(t, a, "POST", "/api/notifications/status", inputEndpoint(input), visitor), 200)
	assertWelcomeError(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 423, "welcome_required")
	state = changeWelcome(t, a, host, state.Revision, "next")
	state = changeWelcome(t, a, host, state.Revision, "next")
	selectGuestWelcomeStep(t, a, visitor, 1)
	assertWelcomeError(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 423, "welcome_required")
	selectGuestWelcomeStep(t, a, visitor, 2)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 200)
	state = changeWelcome(t, a, host, state.Revision, "next")
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 200)
	selectGuestWelcomeStep(t, a, visitor, 3)
	assertWelcomeError(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 423, "welcome_required")
	status(t, request(t, a, "DELETE", "/api/notifications/subscription", inputEndpoint(input), visitor), 204)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, host), 200)
}

type notificationHTTPFunc func(*http.Request) (*http.Response, error)

func (f notificationHTTPFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

func notificationOutboxCount(t *testing.T, a *App) int {
	t.Helper()
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM notification_outbox").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func queuedTestNotification(t *testing.T, a *App) (*http.Cookie, *http.Cookie, welcomeState, notificationInput) {
	t.Helper()
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Subscribed guest")
	input := testNotificationInput(t)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", input, visitor), 200)
	steps := []welcomeStep{testWelcomeStep("Private authored step", ""), testWelcomeStep("Another private step", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	readGuestWelcome(t, a, visitor)
	state = changeWelcome(t, a, host, state.Revision, "next")
	if notificationOutboxCount(t, a) != 1 {
		t.Fatal("host unlock did not persist a notification")
	}
	return host, visitor, state, input
}

func TestNotificationsCoalesceEncryptAndPreserveNewerUpdates(t *testing.T) {
	a := testApp(t)
	host, _, state, _ := queuedTestNotification(t, a)
	state = changeWelcome(t, a, host, state.Revision, "next")
	if notificationOutboxCount(t, a) != 1 {
		t.Fatal("successive host updates accumulated notifications")
	}
	var kind string
	if err := a.db.QueryRow("SELECT kind FROM notification_outbox").Scan(&kind); err != nil || kind != "welcome_step" {
		t.Fatal("unlock queued the wrong event")
	}
	calls := 0
	a.notificationSender.Client = notificationHTTPFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		body, err := io.ReadAll(r.Body)
		if err != nil || len(body) < 100 || bytes.Contains(body, []byte("Private authored")) || json.Valid(body) {
			t.Fatal("push payload was not encrypted")
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "vapid t=") || r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("TTL") != "900" || r.Header.Get("Topic") != "birthday-welcome" {
			t.Fatal("Web Push headers were not set")
		}
		if calls == 1 {
			state = changeWelcome(t, a, host, state.Revision, "open")
		}
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	for range 2 {
		processed, err := a.notifications.ProcessNext(t.Context())
		if err != nil || !processed {
			t.Fatalf("notification delivery failed: processed=%v err=%v", processed, err)
		}
	}
	if calls != 2 || notificationOutboxCount(t, a) != 0 {
		t.Fatal("delivery removed a concurrently queued update or left delivered work")
	}
}

func TestNotificationsRetryExpireAndRespectRevocation(t *testing.T) {
	for _, scenario := range []string{"retry limit", "expired endpoint", "logout", "expired session", "inactive guest", "completed welcome", "restarted welcome", "expired message", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			host, visitor, state, input := queuedTestNotification(t, a)
			calls := 0
			a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
				calls++
				code := 201
				switch scenario {
				case "retry limit":
					return nil, errors.New("simulated transport failure")
				case "expired endpoint":
					code = 410
				case "redirect":
					code = 307
				}
				return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(""))}, nil
			})
			switch scenario {
			case "logout":
				status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
			case "expired session":
				if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", a.now().Unix(), guestidentity.HashToken(visitor.Value)); err != nil {
					t.Fatal(err)
				}
			case "inactive guest":
				if _, err := a.db.Exec("UPDATE guests SET active=0 WHERE id=(SELECT guest_id FROM sessions WHERE token_hash=$1)", guestidentity.HashToken(visitor.Value)); err != nil {
					t.Fatal(err)
				}
			case "completed welcome":
				changeWelcome(t, a, host, state.Revision, "open")
				moveGuestWelcome(t, a, visitor, "finish")
			case "restarted welcome":
				state = changeWelcome(t, a, host, state.Revision, "open")
				changeWelcome(t, a, host, state.Revision, "start")
			case "expired message":
				now := a.now().Add(notifications.Lifetime)
				a.now = func() time.Time { return now }
			}
			iterations := 1
			if scenario == "retry limit" {
				iterations = 5
			}
			for range iterations {
				if _, err := a.notifications.ProcessNext(t.Context()); err != nil {
					t.Fatal(err)
				}
				now := a.now().Add(time.Minute)
				a.now = func() time.Time { return now }
			}
			if notificationOutboxCount(t, a) != 0 {
				t.Fatal("terminal or unauthorized notification remained queued")
			}
			wantCalls := 0
			if scenario == "retry limit" {
				wantCalls = 5
			}
			if scenario == "expired endpoint" || scenario == "redirect" {
				wantCalls = 1
			}
			if calls != wantCalls {
				t.Fatalf("delivery calls=%d want=%d", calls, wantCalls)
			}
			if scenario == "expired endpoint" && notificationSubscribed(t, a, visitor, input.Endpoint) {
				t.Fatal("expired endpoint remained subscribed")
			}
		})
	}
}

func TestNotificationWorkerStopsOnClose(t *testing.T) {
	a := testApp(t)
	queuedTestNotification(t, a)
	started := make(chan struct{})
	a.notificationSender.Client = notificationHTTPFunc(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	if err := a.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("notification worker did not start")
	}
	closed := make(chan error, 1)
	go func() { closed <- a.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("closing did not cancel delivery")
	}
}

func TestNotificationsIncludeAdministratorsWhoOptIn(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", testNotificationInput(t), host), 200)
	steps := []welcomeStep{testWelcomeStep("Welcome", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "open")
	readGuestWelcome(t, a, host)
	calls := 0
	a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if processed, err := a.notifications.ProcessNext(t.Context()); err != nil || !processed || calls != 1 {
		t.Fatal("an opted-in administrator did not receive the welcome update")
	}
}

func TestNotificationDeliveryKeepsReboundSubscription(t *testing.T) {
	a := testApp(t)
	host, visitor, _, input := queuedTestNotification(t, a)
	a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
		status(t, request(t, a, "PUT", "/api/notifications/subscription", input, host), 200)
		return &http.Response{StatusCode: 410, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if processed, err := a.notifications.ProcessNext(t.Context()); err != nil || !processed {
		t.Fatalf("delivery did not complete: processed=%v err=%v", processed, err)
	}
	if notificationSubscribed(t, a, visitor, input.Endpoint) || !notificationSubscribed(t, a, host, input.Endpoint) {
		t.Fatal("a stale endpoint failure removed the new subscription owner")
	}
	if notificationOutboxCount(t, a) != 0 {
		t.Fatal("rebinding retained a previous owner's notification")
	}
}

func TestNotificationSubscriptionRechecksWidgetAfterReadingBody(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Changing widget guest")
	steps := []welcomeStep{{Widgets: []welcomeWidget{{Type: "enable_notifications"}}}, testWelcomeStep("No permission here", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	state = changeWelcome(t, a, host, state.Revision, "start")
	state = changeWelcome(t, a, host, state.Revision, "next")
	selectGuestWelcomeStep(t, a, visitor, 1)
	changeWelcome(t, a, host, state.Revision, "next")
	encoded, _ := json.Marshal(testNotificationInput(t))
	body := &notificationActionReader{reader: bytes.NewReader(encoded), action: func() { moveGuestWelcome(t, a, visitor, "next") }}
	r := httptest.NewRequest("PUT", "/api/notifications/subscription", body)
	r.AddCookie(visitor)
	r.Header.Set("X-Requested-With", "birthday-party")
	assertWelcomeError(t, performMediaUpload(a, r), 423, "welcome_required")
}

type notificationActionReader struct {
	reader io.Reader
	action func()
}

func (r *notificationActionReader) Read(buffer []byte) (int, error) {
	if r.action != nil {
		r.action()
		r.action = nil
	}
	return r.reader.Read(buffer)
}
