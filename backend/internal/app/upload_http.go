package app

import (
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var uploadUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func (a *App) getUpload(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	job, err := a.media.Upload(r.Context(), id, guest.ID)
	if errors.Is(err, media.ErrNotFound) {
		fail(w, 404, "upload_not_found")
		return
	}
	if err != nil {
		failUpload(w, err)
		return
	}
	respond(w, 200, job)
}
func (a *App) listUploads(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	items, err := a.media.Recent(r.Context(), guest.ID)
	if err != nil {
		failUpload(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}
func (a *App) uploadPhoto(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	clientID := strings.ToLower(r.Header.Get("X-Upload-ID"))
	if clientID != "" && !uploadUUID.MatchString(clientID) {
		fail(w, 400, "invalid_upload_id")
		return
	}
	destination, err := parseUploadDestination(r)
	if err != nil {
		failUpload(w, err)
		return
	}
	existing, err := a.media.Inspect(r.Context(), guest.ID, clientID, &destination)
	if err != nil {
		failUpload(w, err)
		return
	}
	if existing != nil {
		respond(w, 202, existing)
		return
	}
	if clientID == "" {
		clientID, err = media.NewUploadID()
		if err != nil {
			internal(w, err)
			return
		}
	}
	select {
	case a.receivers <- struct{}{}:
		defer func() { <-a.receivers }()
	case <-r.Context().Done():
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, max(a.config.MaxImageBytes, a.config.MaxVideoBytes)+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "photo_required")
		return
	}
	input, err := a.mediaFiles.Receive(reader)
	if err != nil {
		failUpload(w, err)
		return
	}
	defer a.mediaFiles.RemoveReceived(input)
	job, err := a.media.Accept(r.Context(), guest.ID, clientID, input, destination)
	if err != nil {
		failUpload(w, err)
		return
	}
	respond(w, 202, job)
}

func failUpload(w http.ResponseWriter, err error) {
	var failure *media.Error
	if !errors.As(err, &failure) {
		internal(w, err)
		return
	}
	status := http.StatusBadRequest
	switch failure.Code {
	case "access_revoked", "session_expired":
		status = http.StatusUnauthorized
	case "photo_delete_forbidden":
		status = http.StatusForbidden
	case "media_category_not_found", "photo_not_found", "photo_unavailable":
		status = http.StatusNotFound
	case "welcome_conflict", "upload_queue_full", "album_full", "media_category_limit":
		status = http.StatusConflict
	case "photo_too_large", "video_too_large", "photo_dimensions_too_large", "video_dimensions_too_large", "video_too_long":
		status = http.StatusRequestEntityTooLarge
	case "unsupported_photo_type", "unreadable_photo", "unreadable_video":
		status = http.StatusUnsupportedMediaType
	case "video_processing_failed":
		status = http.StatusUnprocessableEntity
	case "welcome_required":
		status = http.StatusLocked
	}
	fail(w, status, failure.Code)
}
