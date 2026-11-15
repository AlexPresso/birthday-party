package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestLogRequestsWritesOneLinePerRequest(t *testing.T) {
	tests := []struct {
		name      string
		target    string
		forwarded string
		handler   http.HandlerFunc
		want      string
	}{
		{
			name:    "explicit status",
			target:  "/api/session",
			handler: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) },
			want:    `^HTTP/1\.1 GET "/api/session" 401 \S+ 192\.0\.2\.1$`,
		},
		{
			name:    "implicit status on write",
			target:  "/api/photos?category=4",
			handler: func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("{}")) },
			want:    `^HTTP/1\.1 GET "/api/photos" 200 `,
		},
		{
			name:    "nothing written",
			target:  "/api/health",
			handler: func(http.ResponseWriter, *http.Request) {},
			want:    `^HTTP/1\.1 GET "/api/health" 200 `,
		},
		{
			name:    "control characters stay on one line",
			target:  "/api/%0Afake",
			handler: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			want:    `^HTTP/1\.1 GET "/api/\\nfake" 404 `,
		},
		{
			name:      "forwarded chain",
			target:    "/api/programme",
			forwarded: "203.0.113.5, 198.51.100.7",
			handler:   func(http.ResponseWriter, *http.Request) {},
			want:      ` 192\.0\.2\.1 forwarded="203\.0\.113\.5, 198\.51\.100\.7"$`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var lines []string
			logf := func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			if test.forwarded != "" {
				request.Header.Set("X-Forwarded-For", test.forwarded)
			}
			logRequests(test.handler, logf).ServeHTTP(httptest.NewRecorder(), request)
			if len(lines) != 1 || strings.Contains(lines[0], "\n") {
				t.Fatalf("log lines = %q, want one line", lines)
			}
			if !regexp.MustCompile(test.want).MatchString(lines[0]) {
				t.Fatalf("log line = %q, want match for %s", lines[0], test.want)
			}
		})
	}
}

func TestLogRequestsLetsWebSocketsUpgrade(t *testing.T) {
	logged := make(chan string, 1)
	logf := func(format string, args ...any) { logged <- fmt.Sprintf(format, args...) }
	server := httptest.NewServer(logRequests(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_ = connection.Close(websocket.StatusNormalClosure, "")
	}), logf))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/realtime", nil)
	if err != nil {
		t.Fatalf("dial through the access log: %v", err)
	}
	_, _, _ = connection.Read(ctx)
	_ = connection.CloseNow()
	select {
	case line := <-logged:
		if !strings.Contains(line, `GET "/api/realtime" 101 `) {
			t.Fatalf("log line = %q, want status 101", line)
		}
	case <-ctx.Done():
		t.Fatal("the WebSocket request was not logged")
	}
}

func TestLogRequestsKeepsResponseControllerFeatures(t *testing.T) {
	handler := func(w http.ResponseWriter, _ *http.Request) {
		if err := http.NewResponseController(w).Flush(); err != nil {
			t.Errorf("Flush through the recorder: %v", err)
		}
	}
	response := httptest.NewRecorder()
	logRequests(http.HandlerFunc(handler), func(string, ...any) {}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/realtime", nil))
	if !response.Flushed {
		t.Fatal("the underlying writer was not flushed")
	}
}
