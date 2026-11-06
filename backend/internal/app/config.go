package app

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	push "birthday-party/backend/internal/adapters/webpush"
	"birthday-party/backend/internal/party"
)

const (
	defaultMaxImageBytes     int64 = 15 << 20
	defaultMaxVideoBytes     int64 = 100 << 20
	maxConfiguredUploadBytes int64 = 1024 << 20
)

// Config controls the HTTP service, PostgreSQL connection and private media storage.
// Product configuration and upload limits seed PostgreSQL once. Zero upload
// limits use the defaults in Open; DatabaseURL must be supplied.
type Config struct {
	ListenAddr                string
	PublicURL                 string
	DataDir                   string
	DatabaseURL               string
	CookieSecure              bool
	PrintAdminInvitation      bool
	MaxImageBytes             int64
	MaxVideoBytes             int64
	VAPIDSubject              string
	ProductConfiguration      party.Configuration
	initialConfigurationError error
}

// ConfigFromEnv reads and validates process environment variables without loading files.
// Product seed errors are deferred until Open knows whether import is needed.
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
		c.initialConfigurationError = err
	}
	if c.MaxVideoBytes, err = uploadLimitFromEnv("MAX_VIDEO_SIZE_MB", defaultMaxVideoBytes); err != nil {
		if c.initialConfigurationError == nil {
			c.initialConfigurationError = err
		}
	}
	if c.VAPIDSubject, err = push.Subject(os.Getenv("VAPID_SUBJECT"), c.PublicURL); err != nil {
		return c, err
	}
	c.ProductConfiguration = productConfigurationFromEnv()
	return c, nil
}

func productConfigurationFromEnv() party.Configuration {
	configuration := party.DefaultConfiguration()
	if age, err := strconv.Atoi(strings.TrimSpace(os.Getenv("BIRTHDAY_AGE"))); err == nil && age >= 1 && age <= 150 {
		configuration.Age = age
	}
	readText := func(suffix string) party.InvitationText {
		read := func(name string) *string {
			value, exists := os.LookupEnv(name + suffix)
			if !exists {
				return nil
			}
			value = strings.TrimSpace(value)
			return &value
		}
		return party.InvitationText{Title: read("INVITATION_TITLE"), Description: read("INVITATION_DESCRIPTION")}
	}
	configuration.Invitation.InvitationText = readText("")
	for locale := range configuration.Invitation.Locales {
		configuration.Invitation.Locales[locale] = readText("_" + strings.ToUpper(locale))
	}
	return configuration
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
