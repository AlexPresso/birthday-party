package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

const (
	cookieName                     = "birthday_session"
	invitationTTL                  = 7 * 24 * time.Hour
	sessionTTL                     = 90 * 24 * time.Hour
	defaultMaxImageBytes     int64 = 15 << 20
	defaultMaxVideoBytes     int64 = 100 << 20
	maxConfiguredUploadBytes int64 = 1024 << 20
)

type Config struct {
	ListenAddr           string
	PublicURL            string
	DataDir              string
	DatabaseURL          string
	CookieSecure         bool
	PrintAdminInvitation bool
	MaxImageBytes        int64
	MaxVideoBytes        int64
}

func ConfigFromEnv() (Config, error) {
	c := Config{ListenAddr: env("LISTEN_ADDR", "127.0.0.1:8080"), PublicURL: strings.TrimRight(env("PUBLIC_URL", "http://localhost:3000"), "/"), DataDir: env("DATA_DIR", "./data"), DatabaseURL: os.Getenv("DATABASE_URL")}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	u, err := url.Parse(c.PublicURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("PUBLIC_URL must be an HTTP(S) origin without a path")
	}
	c.CookieSecure = u.Scheme == "https"
	if value := os.Getenv("COOKIE_SECURE"); value != "" {
		c.CookieSecure, err = strconv.ParseBool(value)
		if err != nil {
			return c, errors.New("COOKIE_SECURE must be true or false")
		}
	}
	if u.Scheme == "https" && !c.CookieSecure {
		return c, errors.New("COOKIE_SECURE must be true when PUBLIC_URL uses HTTPS")
	}
	if value := os.Getenv("PRINT_ADMIN_INVITATION"); value != "" {
		c.PrintAdminInvitation, err = strconv.ParseBool(value)
		if err != nil {
			return c, errors.New("PRINT_ADMIN_INVITATION must be true or false")
		}
	}
	if c.MaxImageBytes, err = uploadLimitFromEnv("MAX_IMAGE_SIZE_MB", defaultMaxImageBytes); err != nil {
		return c, err
	}
	if c.MaxVideoBytes, err = uploadLimitFromEnv("MAX_VIDEO_SIZE_MB", defaultMaxVideoBytes); err != nil {
		return c, err
	}
	return c, nil
}

func uploadLimitFromEnv(name string, fallback int64) (int64, error) {
	value := os.Getenv(name)
	if value == "" {
		return fallback, nil
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, fmt.Errorf("%s must be an integer between 1 and 1024", name)
		}
	}
	size, err := strconv.ParseInt(value, 10, 64)
	if err != nil || size < 1 || size > 1024 {
		return 0, fmt.Errorf("%s must be an integer between 1 and 1024", name)
	}
	return size << 20, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

type Guest struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Active bool   `json:"active"`
}

type Author struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type App struct {
	db           *sql.DB
	config       Config
	now          func() time.Time
	receivers    chan struct{}
	workerMu     sync.Mutex
	workerCancel context.CancelFunc
	workerConn   *sql.Conn
	workerErrors chan error
	workers      sync.WaitGroup
	closeOnce    sync.Once
	closeErr     error
	authMu       sync.Mutex
	authWindow   time.Time
	authCount    int
}

func Open(config Config) (*App, error) {
	if config.MaxImageBytes == 0 {
		config.MaxImageBytes = defaultMaxImageBytes
	}
	if config.MaxVideoBytes == 0 {
		config.MaxVideoBytes = defaultMaxVideoBytes
	}
	if config.MaxImageBytes < 1<<20 || config.MaxImageBytes > maxConfiguredUploadBytes || config.MaxVideoBytes < 1<<20 || config.MaxVideoBytes > maxConfiguredUploadBytes {
		return nil, errors.New("upload limits must be between 1 MiB and 1024 MiB")
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "photos"), 0700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "tmp"), 0700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "uploads"), 0700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := openDatabase(ctx, config.DatabaseURL, config.DataDir)
	if err != nil {
		return nil, err
	}
	return &App{db: db, config: config, now: time.Now, receivers: make(chan struct{}, 4), workerErrors: make(chan error, 1)}, nil
}

func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.workerMu.Lock()
		if a.workerCancel != nil {
			a.workerCancel()
		}
		a.workerMu.Unlock()
		a.workers.Wait()
		if a.workerConn != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, _ = a.workerConn.ExecContext(ctx, "SELECT pg_advisory_unlock(hashtext(current_schema()), 73002)")
			cancel()
			_ = a.workerConn.Close()
		}
		a.closeErr = a.db.Close()
	})
	return a.closeErr
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("POST /api/invitations/preview", a.previewInvitation)
	mux.HandleFunc("POST /api/invitations/accept", a.acceptInvitation)
	mux.HandleFunc("GET /api/session", a.auth(false, func(w http.ResponseWriter, r *http.Request, guest Guest) {
		respond(w, 200, map[string]any{"guest": guest})
	}))
	mux.HandleFunc("POST /api/logout", a.auth(false, a.logout))
	mux.HandleFunc("GET /api/party", a.auth(false, a.getParty))
	mux.HandleFunc("PATCH /api/admin/party", a.auth(true, a.updateParty))
	mux.HandleFunc("GET /api/admin/guests", a.auth(true, a.listGuests))
	mux.HandleFunc("POST /api/admin/guests", a.auth(true, a.createGuest))
	mux.HandleFunc("POST /api/admin/guests/{id}/invitation", a.auth(true, a.renewInvitation))
	mux.HandleFunc("DELETE /api/admin/guests/{id}", a.auth(true, a.revokeGuest))
	mux.HandleFunc("GET /api/programme", a.auth(false, a.listProgramme))
	mux.HandleFunc("GET /api/admin/programme", a.auth(true, a.listAdminProgramme))
	mux.HandleFunc("POST /api/admin/programme", a.auth(true, a.createEvent))
	mux.HandleFunc("PUT /api/admin/programme/{id}", a.auth(true, a.updateEvent))
	mux.HandleFunc("DELETE /api/admin/programme/{id}", a.auth(true, a.deleteEvent))
	mux.HandleFunc("GET /api/guestbook", a.auth(false, a.listEntries))
	mux.HandleFunc("POST /api/guestbook", a.auth(false, a.createEntry))
	mux.HandleFunc("DELETE /api/guestbook/{id}", a.auth(false, a.deleteEntry))
	mux.HandleFunc("GET /api/photos", a.auth(false, a.listPhotos))
	mux.HandleFunc("POST /api/photos", a.auth(false, a.uploadPhoto))
	mux.HandleFunc("GET /api/uploads", a.auth(false, a.listUploads))
	mux.HandleFunc("GET /api/uploads/{id}", a.auth(false, a.getUpload))
	mux.HandleFunc("GET /api/photos/{id}/image", a.auth(false, a.servePhoto))
	mux.HandleFunc("DELETE /api/photos/{id}", a.auth(false, a.deletePhoto))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("X-Requested-With") != "birthday-party" || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.config.PublicURL) {
				fail(w, 403, "request_forbidden")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (a *App) auth(admin bool, next func(http.ResponseWriter, *http.Request, Guest)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieName)
		if err != nil || !validToken(cookie.Value) {
			fail(w, 401, "invitation_required")
			return
		}
		var guest Guest
		err = a.db.QueryRowContext(r.Context(), `SELECT g.id,g.name,g.role,g.active FROM sessions s JOIN guests g ON g.id=s.guest_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND g.active=1`, hashToken(cookie.Value), a.now().Unix()).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 401, "session_expired")
			return
		}
		if err != nil {
			internal(w, err)
			return
		}
		if admin && guest.Role != "admin" {
			fail(w, 403, "admin_required")
			return
		}
		next(w, r, guest)
	}
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		fail(w, 400, "invalid_body")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, 400, "invalid_body")
		return false
	}
	return true
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func fail(w http.ResponseWriter, status int, code string) {
	message, ok := errorMessages[code]
	if !ok {
		code = "internal_error"
		message = errorMessages[code]
	}
	respond(w, status, map[string]string{"code": code, "error": message})
}

func internal(w http.ResponseWriter, err error) {
	log.Printf("request failed: %v", err)
	fail(w, 500, "internal_error")
}

func newToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func validToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == 32
}

func hashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		fail(w, 400, "invalid_id")
		return 0, false
	}
	return id, true
}

func page(w http.ResponseWriter, r *http.Request) (int64, int, bool) {
	before := int64(0)
	limit := 24
	var err error
	if value := r.URL.Query().Get("before"); value != "" {
		before, err = strconv.ParseInt(value, 10, 64)
		if err != nil || before < 1 {
			fail(w, 400, "invalid_cursor")
			return 0, 0, false
		}
	}
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 48 {
			fail(w, 400, "invalid_page_size")
			return 0, 0, false
		}
	}
	return before, limit, true
}

func cursor(id int64) *string { result := strconv.FormatInt(id, 10); return &result }

func affected(w http.ResponseWriter, result sql.Result, err error) bool {
	if err != nil {
		internal(w, err)
		return false
	}
	n, err := result.RowsAffected()
	if err != nil {
		internal(w, err)
		return false
	}
	if n == 0 {
		fail(w, 404, "not_found")
		return false
	}
	return true
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
