package app

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"birthday-party/backend/internal/access"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type realtimeTopics uint8

const (
	realtimeWelcome realtimeTopics = 1 << iota
	realtimeUploads
	realtimeProgramme
	realtimeAuth
)

const (
	realtimeSessionEnded          websocket.StatusCode = 4401
	realtimeMaxConnections                             = 512
	realtimeMaxSessionConnections                      = 8
	realtimeHeartbeat                                  = 20 * time.Second
)

type realtimeClient struct {
	guestID int64
	session string
	pending realtimeTopics // Protected by the hub mutex.
	wake    chan struct{}
	stop    chan websocket.StatusCode
	cancel  context.CancelFunc
}

type realtimeHub struct {
	mu          sync.Mutex
	clients     map[*realtimeClient]struct{}
	closed      bool
	connections sync.WaitGroup
}

func newRealtimeHub() *realtimeHub {
	return &realtimeHub{clients: make(map[*realtimeClient]struct{})}
}

func (h *realtimeHub) subscribe(client *realtimeClient) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || len(h.clients) >= realtimeMaxConnections {
		return false
	}
	count := 0
	for existing := range h.clients {
		if existing.session == client.session {
			count++
		}
	}
	if count >= realtimeMaxSessionConnections {
		return false
	}
	h.clients[client] = struct{}{}
	h.connections.Add(1)
	return true
}

func (h *realtimeHub) unsubscribe(client *realtimeClient) {
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()
	client.cancel()
	h.connections.Done()
}

// Notifications are hints. Keep at most one pending set of topics per socket;
// reconnecting clients refetch from PostgreSQL after receiving ready.
func (h *realtimeHub) notify(guestID int64, topics realtimeTopics) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		if guestID != 0 && client.guestID != guestID {
			continue
		}
		client.pending |= topics
		select {
		case client.wake <- struct{}{}:
		default:
		}
	}
}

func (h *realtimeHub) take(client *realtimeClient) realtimeTopics {
	h.mu.Lock()
	defer h.mu.Unlock()
	topics := client.pending
	client.pending = 0
	return topics
}

func (h *realtimeHub) endSessions(guestID int64, session string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		if (guestID != 0 && client.guestID == guestID) || (session != "" && client.session == session) {
			select {
			case client.stop <- realtimeSessionEnded:
			default:
			}
		}
	}
}

func (h *realtimeHub) close() {
	h.mu.Lock()
	h.closed = true
	for client := range h.clients {
		client.cancel()
	}
	h.mu.Unlock()
	h.connections.Wait()
}

type realtimeMessage struct {
	Type   string   `json:"type"`
	Topics []string `json:"topics,omitempty"`
}

func (a *App) realtimeHTTP(w http.ResponseWriter, r *http.Request) {
	// Browsers send Origin for WebSockets. Compare the complete configured
	// origin, including scheme and port, rather than accepting wildcard hosts.
	origins := r.Header.Values("Origin")
	if len(origins) != 1 || origins[0] != a.config.PublicURL {
		fail(w, "request_forbidden")
		return
	}
	if r.URL.RawQuery != "" {
		fail(w, "invalid_body")
		return
	}
	a.auth(false, a.connectRealtime)(w, r)
}

func (a *App) realtimeAccess(ctx context.Context, client *realtimeClient) (time.Time, bool, error) {
	query, cancel := context.WithTimeout(ctx, workerQueryTimeout)
	defer cancel()
	return a.access.Realtime(query, client.session, client.guestID, a.now())
}

func (a *App) connectRealtime(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	// The upgraded connection has its own lifetime. App.Close cancels and waits
	// for every registered handler, including upgrades still in progress.
	ctx, cancel := context.WithCancel(context.Background())
	client := &realtimeClient{guestID: viewer.Guest.ID, session: viewer.SessionHash, wake: make(chan struct{}, 1), stop: make(chan websocket.StatusCode, 1), cancel: cancel}
	if !a.realtime.subscribe(client) {
		cancel()
		w.Header().Set("Retry-After", "5")
		fail(w, "too_many_attempts")
		return
	}
	defer a.realtime.unsubscribe(client)
	// Origin was checked exactly above. The backend Host can differ because the
	// same-origin Next.js proxy forwards the upgrade to an internal service name.
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(128)
	ctx = connection.CloseRead(ctx)
	expires, _, err := a.realtimeAccess(ctx, client)
	if !closeRealtimeOnAuthError(connection, err) {
		return
	}
	if !writeRealtime(ctx, connection, realtimeMessage{Type: "ready"}) {
		return
	}
	expiry := time.NewTimer(max(0, expires.Sub(a.now())))
	defer expiry.Stop()
	heartbeat := time.NewTicker(realtimeHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case code := <-client.stop:
			_ = connection.Close(code, "Session ended")
			return
		case <-expiry.C:
			_ = connection.Close(realtimeSessionEnded, "Session ended")
			return
		case <-heartbeat.C:
			if _, _, err := a.realtimeAccess(ctx, client); !closeRealtimeOnAuthError(connection, err) {
				return
			}
			if !writeRealtime(ctx, connection, realtimeMessage{Type: "heartbeat"}) {
				return
			}
			ping, cancelPing := context.WithTimeout(ctx, 5*time.Second)
			err := connection.Ping(ping)
			cancelPing()
			if err != nil {
				return
			}
		case <-client.wake:
			topics := a.realtime.take(client)
			_, programme, err := a.realtimeAccess(ctx, client)
			if !closeRealtimeOnAuthError(connection, err) {
				return
			}
			if !programme {
				topics &^= realtimeProgramme
			}
			message := realtimeMessage{Type: "invalidate"}
			for _, topic := range []struct {
				flag realtimeTopics
				name string
			}{{realtimeWelcome, "welcome"}, {realtimeUploads, "uploads"}, {realtimeProgramme, "programme"}} {
				if topics&topic.flag != 0 {
					message.Topics = append(message.Topics, topic.name)
				}
			}
			if len(message.Topics) > 0 && !writeRealtime(ctx, connection, message) {
				return
			}
		}
	}
}

func closeRealtimeOnAuthError(connection *websocket.Conn, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, access.ErrExpired) {
		_ = connection.Close(realtimeSessionEnded, "Session ended")
	} else {
		_ = connection.Close(websocket.StatusTryAgainLater, "Reconnect to continue")
	}
	return false
}

func writeRealtime(ctx context.Context, connection *websocket.Conn, message realtimeMessage) bool {
	write, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return wsjson.Write(write, connection, message) == nil
}
