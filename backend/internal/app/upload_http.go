package app

import (
	"net/http"
	"regexp"
	"strings"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/media"
)

var uploadUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func (a *App) getUpload(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	job, err := a.media.Upload(r.Context(), id, viewer.Guest.ID)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, job)
}

func (a *App) listUploads(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	items, err := a.media.Recent(r.Context(), viewer.Guest.ID)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{"items": items})
}

func (a *App) uploadPhoto(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	clientID := strings.ToLower(r.Header.Get("X-Upload-ID"))
	if clientID != "" && !uploadUUID.MatchString(clientID) {
		fail(w, "invalid_upload_id")
		return
	}
	destination, err := parseUploadDestination(r, viewer)
	if err != nil {
		failError(w, err)
		return
	}
	existing, err := a.media.Inspect(r.Context(), viewer.Guest.ID, clientID, &destination)
	if err != nil {
		failError(w, err)
		return
	}
	if existing != nil {
		respond(w, http.StatusAccepted, existing)
		return
	}
	if clientID == "" {
		clientID, err = media.NewUploadID()
		if err != nil {
			failError(w, err)
			return
		}
	}
	release, ok := a.acquireReceiver(w, r)
	if !ok {
		return
	}
	defer release()
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	boundReception(w, r, max(limits.ImageBytes, limits.VideoBytes)+multipartOverhead)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, "photo_required")
		return
	}
	input, err := a.mediaFiles.Receive(reader, limits.ImageBytes, limits.VideoBytes)
	if err != nil {
		failError(w, err)
		return
	}
	defer a.mediaFiles.RemoveReceived(input)
	job, err := a.media.Accept(r.Context(), viewer.Guest.ID, clientID, input, destination)
	if err != nil {
		failError(w, err)
		return
	}
	a.mediaWake.notify()
	respond(w, http.StatusAccepted, job)
}
