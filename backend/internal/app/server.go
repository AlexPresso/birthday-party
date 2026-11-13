package app

import (
	"net/http"
	"time"
)

const (
	// Ordinary routes exchange small JSON documents, so slow or stalled clients
	// are cut off quickly. WriteTimeout also covers the handler's own work.
	requestReadTimeout   = 30 * time.Second
	responseWriteTimeout = 60 * time.Second

	// Media routes can move up to maxConfiguredUploadBytes over a phone
	// connection. Their deadline grows with the size at this minimum rate.
	minTransferRate = 64 << 10 // bytes per second
	transferGrace   = 2 * time.Minute

	// Multipart boundaries and part headers surrounding one uploaded file.
	multipartOverhead = 64 << 10
)

// HTTPServer returns the server for Handler. Its deadlines suit ordinary routes;
// upload and download handlers replace them for their own request.
func (a *App) HTTPServer() *http.Server {
	return &http.Server{
		Addr:              a.config.ListenAddr,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       requestReadTimeout,
		WriteTimeout:      responseWriteTimeout,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}

// transferAllowance is the time size bytes may take at the slowest supported rate.
func transferAllowance(size int64) time.Duration {
	return transferGrace + time.Duration(size/minTransferRate)*time.Second
}

// acquireReceiver waits for one of the bounded request-body slots. Nothing is
// read or written while waiting, so the server's short deadlines are lifted
// until boundReception sets the ones for the transfer. It reports false when
// the client gave up first; otherwise the caller must call release.
func (a *App) acquireReceiver(w http.ResponseWriter, r *http.Request) (release func(), ok bool) {
	connection := http.NewResponseController(w)
	// Deadline support is absent on test recorders; a real connection that
	// rejects a deadline is already closed and fails at the next read or write.
	_ = connection.SetReadDeadline(time.Time{})
	_ = connection.SetWriteDeadline(time.Time{})
	select {
	case a.receivers <- struct{}{}:
		return func() { <-a.receivers }, true
	case <-r.Context().Done():
		return nil, false
	}
}

// boundReception caps the request body at limit bytes and gives the connection
// the time needed to deliver them, plus the time to answer afterwards.
func boundReception(w http.ResponseWriter, r *http.Request, limit int64) {
	expected := limit
	if r.ContentLength >= 0 && r.ContentLength < limit {
		expected = r.ContentLength
	}
	received := time.Now().Add(transferAllowance(expected))
	connection := http.NewResponseController(w)
	_ = connection.SetReadDeadline(received)
	_ = connection.SetWriteDeadline(received.Add(responseWriteTimeout))
	r.Body = http.MaxBytesReader(w, r.Body, limit)
}

// allowDownload gives the connection the time needed to send size bytes.
func allowDownload(w http.ResponseWriter, size int64) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(transferAllowance(size)))
}
