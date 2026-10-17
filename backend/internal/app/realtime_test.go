package app

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	guestidentity "birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type testRealtimeConnection struct {
	connection *websocket.Conn
	messages   chan realtimeMessage
	errors     chan error
}

func dialRealtime(t *testing.T, a *App, server *httptest.Server, cookie *http.Cookie) *testRealtimeConnection {
	t.Helper()
	header := http.Header{"Origin": {a.config.PublicURL}, "Cookie": {cookie.String()}}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	connection, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/realtime", &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		if response != nil {
			t.Fatalf("WebSocket upgrade failed: status=%d err=%v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	socket := &testRealtimeConnection{connection: connection, messages: make(chan realtimeMessage, 32), errors: make(chan error, 1)}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var message realtimeMessage
			if err := wsjson.Read(t.Context(), connection, &message); err != nil {
				socket.errors <- err
				return
			}
			select {
			case socket.messages <- message:
			case <-t.Context().Done():
				return
			}
		}
	}()
	t.Cleanup(func() { connection.CloseNow(); <-done })
	return socket
}

func readRealtime(t *testing.T, socket *testRealtimeConnection, kind string, topics ...string) {
	t.Helper()
	select {
	case message := <-socket.messages:
		if message.Type != kind || strings.Join(message.Topics, ",") != strings.Join(topics, ",") {
			t.Fatalf("realtime message=%+v want type=%s topics=%v", message, kind, topics)
		}
	case err := <-socket.errors:
		t.Fatalf("realtime closed unexpectedly: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatalf("missing realtime %s message", kind)
	}
}

func noRealtime(t *testing.T, socket *testRealtimeConnection) {
	t.Helper()
	select {
	case message := <-socket.messages:
		t.Fatalf("unexpected realtime message: %+v", message)
	case err := <-socket.errors:
		t.Fatalf("realtime closed unexpectedly: %v", err)
	case <-time.After(80 * time.Millisecond):
	}
}

func closedRealtime(t *testing.T, socket *testRealtimeConnection, code websocket.StatusCode) {
	t.Helper()
	select {
	case err := <-socket.errors:
		if websocket.CloseStatus(err) != code {
			t.Fatalf("close status=%d want=%d err=%v", websocket.CloseStatus(err), code, err)
		}
	case message := <-socket.messages:
		t.Fatalf("expected close, received %+v", message)
	case <-time.After(5 * time.Second):
		t.Fatal("WebSocket was not closed")
	}
}

func TestRealtimeRequiresSessionAndExactOrigin(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	for _, test := range []struct {
		name, origin, path string
		cookie             *http.Cookie
		want               int
	}{
		{"anonymous", a.config.PublicURL, "/api/realtime", nil, 401},
		{"missing origin", "", "/api/realtime", host, 403},
		{"foreign origin", "https://other.example.invalid", "/api/realtime", host, 403},
		{"wrong scheme", "https://localhost:3000", "/api/realtime", host, 403},
		{"wrong port", "http://localhost:4000", "/api/realtime", host, 403},
		{"URL credentials", a.config.PublicURL, "/api/realtime?token=not-a-session", host, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			header := http.Header{"Origin": {test.origin}}
			if test.cookie != nil {
				header.Set("Cookie", test.cookie.String())
			}
			connection, response, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(server.URL, "http")+test.path, &websocket.DialOptions{HTTPHeader: header})
			if connection != nil {
				connection.CloseNow()
			}
			if err == nil || response == nil || response.StatusCode != test.want {
				t.Fatalf("upgrade rejection=%v response=%v want=%d", err, response, test.want)
			}
		})
	}
	sockets := make([]*testRealtimeConnection, 0, realtimeMaxSessionConnections)
	for range realtimeMaxSessionConnections {
		socket := dialRealtime(t, a, server, host)
		readRealtime(t, socket, "ready")
		sockets = append(sockets, socket)
	}
	header := http.Header{"Origin": {a.config.PublicURL}, "Cookie": {host.String()}}
	connection, response, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(server.URL, "http")+"/api/realtime", &websocket.DialOptions{HTTPHeader: header})
	if connection != nil {
		connection.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != 429 {
		t.Fatal("per-session WebSocket limit was not enforced")
	}
	for _, socket := range sockets {
		socket.connection.CloseNow()
	}
}

func TestRealtimeScopesWelcomeUploadsAndProgramme(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, _, _ := guest(t, a, host, "First live guest")
	second, _, _ := guest(t, a, host, "Second live guest")
	steps := []welcomeStep{testWelcomeStep("First instruction", ""), {Widgets: []welcomeWidget{{Type: "media_upload", MediaUpload: &welcomeMediaUpload{}}}}}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	hostSocket, firstSocket, secondSocket := dialRealtime(t, a, server, host), dialRealtime(t, a, server, first), dialRealtime(t, a, server, second)
	for _, socket := range []*testRealtimeConnection{hostSocket, firstSocket, secondSocket} {
		readRealtime(t, socket, "ready")
	}
	state = changeWelcome(t, a, host, state.Revision, "start")
	for _, socket := range []*testRealtimeConnection{hostSocket, firstSocket, secondSocket} {
		readRealtime(t, socket, "invalidate", "welcome")
	}
	readGuestWelcome(t, a, first)
	readGuestWelcome(t, a, second)
	state = changeWelcome(t, a, host, state.Revision, "next")
	for _, socket := range []*testRealtimeConnection{hostSocket, firstSocket, secondSocket} {
		readRealtime(t, socket, "invalidate", "welcome")
	}
	if view := readGuestWelcome(t, a, first); view.Step == nil || view.Step.Position != 1 {
		t.Fatalf("welcome invalidation did not reveal the first step on refresh: %+v", view)
	}
	state = changeWelcome(t, a, host, state.Revision, "next")
	for _, socket := range []*testRealtimeConnection{hostSocket, firstSocket, secondSocket} {
		readRealtime(t, socket, "invalidate", "welcome")
	}
	moveGuestWelcome(t, a, first, "next")
	readRealtime(t, firstSocket, "invalidate", "welcome")
	noRealtime(t, hostSocket)
	noRealtime(t, secondSocket)
	status(t, request(t, a, "POST", "/api/admin/programme", map[string]any{"title": "Private event details"}, host), 201)
	readRealtime(t, hostSocket, "invalidate", "programme")
	noRealtime(t, firstSocket)
	noRealtime(t, secondSocket)
	progress := readGuestWelcome(t, a, first)
	uploadRequest := mediaUploadRequest(t, first, nil, &progress.ProgressRevision, "")
	uploadRequest.Header.Set("X-Welcome-Widget-Index", "0")
	response := performMediaUpload(a, uploadRequest)
	status(t, response, 202)
	readRealtime(t, firstSocket, "invalidate", "uploads")
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	readRealtime(t, firstSocket, "invalidate", "uploads")
	a.processUpload(t.Context(), job)
	readRealtime(t, firstSocket, "invalidate", "uploads")
	noRealtime(t, hostSocket)
	noRealtime(t, secondSocket)
}

func TestRealtimeClosesRevokedLoggedOutAndExpiredSessions(t *testing.T) {
	for _, scenario := range []string{"logout", "revocation", "expiry"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			a.now = time.Now
			host, _ := admin(t, a)
			visitor, identity, _ := guest(t, a, host, "Live session")
			if scenario == "expiry" {
				if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", a.now().Add(2*time.Second).Unix(), guestidentity.HashToken(visitor.Value)); err != nil {
					t.Fatal(err)
				}
			}
			server := httptest.NewServer(a.Handler())
			defer server.Close()
			socket := dialRealtime(t, a, server, visitor)
			readRealtime(t, socket, "ready")
			switch scenario {
			case "logout":
				status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
			case "revocation":
				status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
			}
			closedRealtime(t, socket, realtimeSessionEnded)
		})
	}
}

type realtimeHijackWriter struct {
	http.ResponseWriter
	before func()
}

func (w realtimeHijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.before()
	return w.ResponseWriter.(http.Hijacker).Hijack()
}

func TestRealtimeRechecksSessionAfterSubscribing(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a.Handler().ServeHTTP(realtimeHijackWriter{ResponseWriter: w, before: func() {
			if _, err := a.db.Exec("DELETE FROM sessions WHERE token_hash=$1", guestidentity.HashToken(host.Value)); err != nil {
				t.Error(err)
			}
		}}, r)
	}))
	defer server.Close()
	socket := dialRealtime(t, a, server, host)
	closedRealtime(t, socket, realtimeSessionEnded)
}

func TestRealtimeOnlyPublishesCommittedWelcomeChanges(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	socket := dialRealtime(t, a, server, host)
	readRealtime(t, socket, "ready")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 100, "steps": []welcomeStep{testWelcomeStep("Uncommitted", "")}}, host), 409, "welcome_conflict")
	_, err := a.db.Exec(`CREATE FUNCTION reject_welcome_change() RETURNS trigger LANGUAGE plpgsql AS $$
	BEGIN RAISE EXCEPTION 'injected welcome save failure'; END $$;
	CREATE TRIGGER reject_welcome_change BEFORE UPDATE ON welcome FOR EACH ROW EXECUTE FUNCTION reject_welcome_change()`)
	if err != nil {
		t.Fatal(err)
	}
	status(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Rolled back", "")}}, host), 500)
	if _, err := a.db.Exec("DROP TRIGGER reject_welcome_change ON welcome; DROP FUNCTION reject_welcome_change()"); err != nil {
		t.Fatal(err)
	}
	noRealtime(t, socket)
	readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Committed", "")}}, host))
	readRealtime(t, socket, "invalidate", "welcome")
}

func TestRealtimeClosesConnectionsWithApp(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	socket := dialRealtime(t, a, server, host)
	readRealtime(t, socket, "ready")
	closed := make(chan error, 1)
	go func() { closed <- a.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("App.Close did not release WebSockets")
	}
	select {
	case <-socket.errors:
	case <-time.After(time.Second):
		t.Fatal("hijacked connection remained open")
	}
}

func TestRealtimeRejectsClientApplicationMessages(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	socket := dialRealtime(t, a, server, host)
	readRealtime(t, socket, "ready")
	if err := wsjson.Write(t.Context(), socket.connection, map[string]string{"type": "subscribe"}); err != nil {
		t.Fatal(err)
	}
	closedRealtime(t, socket, websocket.StatusPolicyViolation)
}

func TestRealtimeClosesPrunedSessions(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, identity, _ := guest(t, a, host, "Multiple devices")
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	socket := dialRealtime(t, a, server, visitor)
	readRealtime(t, socket, "ready")
	for index := range 5 {
		// Ensure the oldest session is unambiguous even with the fixed test clock.
		now := a.now().Add(time.Second)
		if _, err := a.db.Exec("UPDATE sessions SET created_at=$1 WHERE token_hash=$2", now.Unix()-100, guestidentity.HashToken(visitor.Value)); err != nil {
			t.Fatal(err)
		}
		response := request(t, a, "POST", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10)+"/invitation", nil, host)
		status(t, response, 200)
		var invitation guestidentity.Invitation
		if err := json.Unmarshal(response.Body.Bytes(), &invitation); err != nil {
			t.Fatal(err)
		}
		status(t, request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, invitation.InvitationURL)}, nil), 200)
		if index < 4 {
			noRealtime(t, socket)
		}
	}
	closedRealtime(t, socket, realtimeSessionEnded)
}

func TestRealtimeCoalescesAndBoundsConnections(t *testing.T) {
	hub := newRealtimeHub()
	clients := make([]*realtimeClient, 0, realtimeMaxConnections)
	defer func() {
		for _, client := range clients {
			hub.unsubscribe(client)
		}
		hub.close()
	}()
	for index := range realtimeMaxConnections {
		client := &realtimeClient{guestID: int64(index + 1), session: strconv.Itoa(index), wake: make(chan struct{}, 1), stop: make(chan websocket.StatusCode, 1), cancel: func() {}}
		if !hub.subscribe(client) {
			t.Fatal("capacity rejected early")
		}
		clients = append(clients, client)
	}
	if hub.subscribe(&realtimeClient{session: "overflow"}) {
		t.Fatal("global WebSocket capacity exceeded")
	}
	for range 1000 {
		hub.notify(1, realtimeWelcome)
		hub.notify(1, realtimeUploads)
	}
	if len(clients[0].wake) != 1 || hub.take(clients[0]) != realtimeWelcome|realtimeUploads {
		t.Fatal("pending topics were dropped or not coalesced")
	}
	if len(clients[1].wake) != 0 {
		t.Fatal("guest-scoped updates reached another guest")
	}
}

func TestRealtimeProgrammeTimerReschedulesAndUnlocks(t *testing.T) {
	a := testApp(t)
	a.now = time.Now
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Programme guest")
	if err := a.StartWorkers(t.Context()); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	socket := dialRealtime(t, a, server, visitor)
	readRealtime(t, socket, "ready")
	unlock := stamp(a.now().Add(time.Hour))
	created := request(t, a, "POST", "/api/admin/programme", programme.Input{Title: "A timed surprise", UnlockAt: &unlock}, host)
	status(t, created, 201)
	var event programme.Event
	if err := json.Unmarshal(created.Body.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	readRealtime(t, socket, "invalidate", "programme")
	unlock = stamp(a.now().Add(2 * time.Second))
	status(t, request(t, a, "PUT", "/api/admin/programme/"+strconv.FormatInt(event.ID, 10), programme.Input{Title: event.Title, UnlockAt: &unlock}, host), 200)
	readRealtime(t, socket, "invalidate", "programme")
	readRealtime(t, socket, "invalidate", "programme")
	response := request(t, a, "GET", "/api/programme", nil, visitor)
	status(t, response, 200)
	var result struct {
		Items []programme.Event `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || len(result.Items) != 1 || result.Items[0].Locked {
		t.Fatal("programme invalidation preceded the unlock boundary")
	}
}
