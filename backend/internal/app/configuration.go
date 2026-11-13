package app

import (
	"encoding/json"
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/locale"
	"birthday-party/backend/internal/party"
)

func (a *App) getPublicConfiguration(w http.ResponseWriter, r *http.Request) {
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, configuration.PublicConfiguration)
}

func (a *App) getConfiguration(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	configuration, err := a.configuration.Get(r.Context())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, configuration)
}

func (a *App) updateConfiguration(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var body json.RawMessage
	if !decode(w, r, &body) {
		return
	}
	var input party.Configuration
	if !completeConfiguration(body) || json.Unmarshal(body, &input) != nil {
		fail(w, "invalid_body")
		return
	}
	actor := party.ConfigurationActor{GuestID: viewer.Guest.ID, SessionHash: viewer.SessionHash}
	configuration, err := a.configuration.Update(r.Context(), actor, input)
	if err != nil {
		failError(w, err)
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
	locales := object(invitation["locales"], locale.Supported()...)
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
		failError(w, err)
		return uploadLimits{}, false
	}
	return uploadLimits{ImageBytes: int64(configuration.ImageSizeMB) << 20, VideoBytes: int64(configuration.VideoSizeMB) << 20}, true
}
