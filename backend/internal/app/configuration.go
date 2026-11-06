package app

import (
	"encoding/json"
	"errors"
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/party"
)

func (a *App) getPublicConfiguration(w http.ResponseWriter, r *http.Request) {
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, http.StatusOK, configuration.PublicConfiguration)
}

func (a *App) getConfiguration(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, http.StatusOK, configuration)
}

func (a *App) updateConfiguration(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	var body json.RawMessage
	if !decode(w, r, &body) {
		return
	}
	var input party.Configuration
	if !completeConfiguration(body) || json.Unmarshal(body, &input) != nil {
		fail(w, http.StatusBadRequest, "invalid_body")
		return
	}
	cookie, _ := r.Cookie(cookieName)
	actor := party.ConfigurationActor{GuestID: guest.ID, SessionHash: identity.HashToken(cookie.Value)}
	configuration, err := a.configuration.Update(r.Context(), actor, input)
	if err != nil {
		switch {
		case errors.Is(err, party.ErrInvalidConfiguration):
			fail(w, http.StatusBadRequest, "invalid_configuration")
		case errors.Is(err, access.ErrAdmin):
			fail(w, http.StatusForbidden, "admin_required")
		case errors.Is(err, access.ErrExpired):
			fail(w, http.StatusUnauthorized, "session_expired")
		default:
			internal(w, err)
		}
		return
	}
	respond(w, http.StatusOK, configuration)
}

// Require nullable text fields too: omission must not silently clear saved copy.
func completeConfiguration(body json.RawMessage) bool {
	object := func(raw json.RawMessage, keys ...string) map[string]json.RawMessage {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || len(fields) != len(keys) {
			return nil
		}
		for _, key := range keys {
			if _, exists := fields[key]; !exists {
				return nil
			}
		}
		return fields
	}
	root := object(body, "age", "invitation", "imageSizeMB", "videoSizeMB")
	if root == nil {
		return false
	}
	invitation := object(root["invitation"], "title", "description", "locales")
	if invitation == nil {
		return false
	}
	locales := object(invitation["locales"], "en", "fr", "de", "it", "es")
	if locales == nil {
		return false
	}
	for _, copy := range locales {
		if object(copy, "title", "description") == nil {
			return false
		}
	}
	return true
}

type uploadLimits struct {
	ImageBytes int64 `json:"imageBytes"`
	VideoBytes int64 `json:"videoBytes"`
}

func (a *App) currentUploadLimits(w http.ResponseWriter, r *http.Request) (uploadLimits, bool) {
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		internal(w, err)
		return uploadLimits{}, false
	}
	return uploadLimits{ImageBytes: int64(configuration.ImageSizeMB) << 20, VideoBytes: int64(configuration.VideoSizeMB) << 20}, true
}
