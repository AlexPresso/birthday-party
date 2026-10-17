// Package identity owns guest identities, invitation tokens and browser sessions.
package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"
)

const (
	// InvitationTTL bounds the lifetime of an unused invitation.
	InvitationTTL = 7 * 24 * time.Hour
	// SessionTTL bounds the lifetime of an accepted browser session.
	SessionTTL = 90 * 24 * time.Hour
)

// Guest is the public identity of an invited participant.
type Guest struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	Active    bool    `json:"active"`
	AvatarURL *string `json:"avatarUrl"`
}

// Author is the public attribution attached to a named contribution.
type Author struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

// NewToken creates a URL-safe token with 256 bits of cryptographic randomness.
func NewToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// ValidToken checks the encoding and size before a token reaches the database.
func ValidToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == 32
}

// HashToken produces the digest stored instead of a raw credential.
func HashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

// AvatarURL identifies a versioned, authenticated avatar, or nil when absent.
func AvatarURL(id, version int64) *string {
	if version <= 0 {
		return nil
	}
	value := fmt.Sprintf("/api/guests/%d/avatar?v=%d", id, version)
	return &value
}
