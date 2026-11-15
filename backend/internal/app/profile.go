package app

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/profile"
)

func (a *App) getProfile(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	respondProfile(w, viewer.Guest, limits.ImageBytes)
}

func respondProfile(w http.ResponseWriter, guest identity.Guest, imageBytes int64) {
	respond(w, http.StatusOK, map[string]any{
		"guest":  guest,
		"limits": map[string]int64{"imageBytes": imageBytes},
	})
}

func (a *App) updateAvatar(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	// The photo is spooled to disk briefly; it never stays there.
	release, ok := a.acquireReceiver(w, r, viewer.Guest.ID, limits.ImageBytes+multipartOverhead)
	if !ok {
		return
	}
	boundReception(w, r, limits.ImageBytes+multipartOverhead)
	input, err := a.spoolAvatar(r, limits.ImageBytes)
	release()
	if err != nil {
		failError(w, err)
		return
	}
	defer func() {
		input.Close()
		os.Remove(input.Name())
	}()
	// The image has already been received, so a slow connection cannot hold
	// decode memory; the processor waits its turn for it and reports a busy
	// server only after a long wait.
	data, err := a.profile.Prepare(r.Context(), input)
	if errors.Is(err, profile.Error("profile_photo_busy")) {
		w.Header().Set("Retry-After", "5")
	}
	if err != nil {
		failError(w, err)
		return
	}
	updated, err := a.profile.Save(r.Context(), viewer.Guest.ID, viewer.SessionHash, data)
	if err != nil {
		failError(w, err)
		return
	}
	respondProfile(w, updated, limits.ImageBytes)
}

func (a *App) deleteAvatar(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	updated, err := a.profile.Save(r.Context(), viewer.Guest.ID, viewer.SessionHash, nil)
	if err != nil {
		failError(w, err)
		return
	}
	respondProfile(w, updated, limits.ImageBytes)
}

// spoolAvatar streams the single uploaded image into private temporary storage
// and returns it rewound for decoding. The caller closes and removes the file.
func (a *App) spoolAvatar(r *http.Request, maxImageBytes int64) (*os.File, error) {
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, profile.Error("profile_photo_required")
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		return nil, profile.Error("profile_photo_required")
	}
	input, err := os.CreateTemp(filepath.Join(a.config.DataDir, "tmp"), "avatar-")
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			input.Close()
			os.Remove(input.Name())
		}
	}()
	count, err := io.Copy(input, io.LimitReader(part, maxImageBytes+1))
	if count > maxImageBytes {
		return nil, profile.Error("photo_too_large")
	}
	if err != nil {
		return nil, profile.Error("photo_upload_failed")
	}
	if count == 0 {
		return nil, profile.Error("profile_photo_required")
	}
	if _, err = reader.NextPart(); err != io.EOF {
		return nil, profile.Error("single_photo_required")
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	keep = true
	return input, nil
}

func (a *App) serveAvatar(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, err := strconv.ParseInt(r.URL.Query().Get("v"), 10, 64)
	if err != nil || version <= 0 {
		fail(w, string(profile.ErrNotFound))
		return
	}
	data, err := a.profile.Avatar(r.Context(), id, version)
	if err != nil {
		failError(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"profile-%d.jpg\"", id))
	revalidateMedia(w, strongETag(data))
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
}
