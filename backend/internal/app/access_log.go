package app

import (
	"io"
	"net"
	"net/http"
	"strconv"
	"time"
)

// logRequests writes one line per request once it has been answered: protocol,
// method, path, status, duration and client address. A WebSocket is logged with
// status 101 when it closes, so its duration is the connection's lifetime.
//
// The path is logged without its query string. No route carries an invitation
// or session token in its path, so neither reaches the log.
func logRequests(next http.Handler, logf func(format string, args ...any)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		logf("%s %s %q %d %s %s", r.Proto, r.Method, r.URL.Path, recorder.status(), time.Since(started).Round(time.Microsecond), clientAddress(r))
	})
}

// clientAddress is the connection's peer, which is the proxy in production,
// followed by the X-Forwarded-For chain the proxies added. That header is
// client-supplied: it is logged for reading and never used for a decision.
func clientAddress(r *http.Request) string {
	address := r.RemoteAddr
	if host, _, err := net.SplitHostPort(address); err == nil {
		address = host
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return address + " forwarded=" + strconv.Quote(forwarded)
	}
	return address
}

// statusRecorder remembers the status sent to the client. Unwrap keeps
// http.ResponseController deadlines and WebSocket hijacking working, and
// ReadFrom keeps the server's sendfile path for media downloads.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (w *statusRecorder) WriteHeader(code int) {
	if w.code == 0 {
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(data []byte) (int, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return w.ResponseWriter.Write(data)
}

func (w *statusRecorder) ReadFrom(source io.Reader) (int64, error) {
	if w.code == 0 {
		w.code = http.StatusOK
	}
	return io.Copy(w.ResponseWriter, source)
}

func (w *statusRecorder) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// status is what net/http sent: 200 when the handler wrote nothing.
func (w *statusRecorder) status() int {
	if w.code == 0 {
		return http.StatusOK
	}
	return w.code
}
