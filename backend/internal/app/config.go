package app

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	push "birthday-party/backend/internal/adapters/webpush"
)

const (
	defaultMaxImageBytes     int64 = 15 << 20
	defaultMaxVideoBytes     int64 = 100 << 20
	maxConfiguredUploadBytes int64 = 1024 << 20
)

// Config controls the HTTP service, PostgreSQL connection and private media storage.
// Zero upload limits use the defaults in Open; DatabaseURL must be supplied.
type Config struct {
	ListenAddr           string
	PublicURL            string
	DataDir              string
	DatabaseURL          string
	CookieSecure         bool
	PrintAdminInvitation bool
	MaxImageBytes        int64
	MaxVideoBytes        int64
	VAPIDSubject         string
}

// ConfigFromEnv reads and validates process environment variables without loading files.
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
	if c.VAPIDSubject, err = push.Subject(os.Getenv("VAPID_SUBJECT"), c.PublicURL); err != nil {
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
