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

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/profile"
)

func failProfile(w http.ResponseWriter, err error) {
	var rejected profile.Error
	if !errors.As(err, &rejected) {
		internal(w, err)
		return
	}
	status := http.StatusBadRequest
	switch string(rejected) {
	case "access_revoked", "session_expired":
		status = http.StatusUnauthorized
	case "welcome_required":
		status = http.StatusLocked
	case "profile_photo_not_found":
		status = http.StatusNotFound
	case "photo_too_large", "photo_dimensions_too_large":
		status = http.StatusRequestEntityTooLarge
	case "unsupported_profile_photo_type", "unreadable_photo":
		status = http.StatusUnsupportedMediaType
	}
	fail(w, status, string(rejected))
}

func (a *App) getProfile(w http.ResponseWriter, _ *http.Request, guest identity.Guest) {
	a.respondProfile(w, guest)
}

func (a *App) respondProfile(w http.ResponseWriter, guest identity.Guest) {
	respond(w, http.StatusOK, map[string]any{
		"guest":  guest,
		"limits": map[string]int64{"imageBytes": a.config.MaxImageBytes},
	})
}

func (a *App) updateAvatar(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	// A single slot bounds temporary storage and decoded memory without queueing
	// profile requests behind gallery conversion workers.
	select {
	case a.avatarProcessors <- struct{}{}:
		defer func() { <-a.avatarProcessors }()
	default:
		w.Header().Set("Retry-After", "2")
		fail(w, http.StatusTooManyRequests, "profile_photo_busy")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.config.MaxImageBytes+(64<<10))
	data, err := a.receiveAvatar(r)
	if err != nil {
		failProfile(w, err)
		return
	}
	cookie, _ := r.Cookie(cookieName)
	updated, err := a.profile.Save(r.Context(), guest.ID, identity.HashToken(cookie.Value), data)
	if err != nil {
		failProfile(w, err)
		return
	}
	a.respondProfile(w, updated)
}

func (a *App) deleteAvatar(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	cookie, _ := r.Cookie(cookieName)
	updated, err := a.profile.Save(r.Context(), guest.ID, identity.HashToken(cookie.Value), nil)
	if err != nil {
		failProfile(w, err)
		return
	}
	a.respondProfile(w, updated)
}

func (a *App) receiveAvatar(r *http.Request) ([]byte, error) {
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
	defer func() {
		input.Close()
		os.Remove(input.Name())
	}()
	count, err := io.Copy(input, io.LimitReader(part, a.config.MaxImageBytes+1))
	if count > a.config.MaxImageBytes {
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
	return a.profile.Prepare(r.Context(), input)
}

func (a *App) serveAvatar(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, err := strconv.ParseInt(r.URL.Query().Get("v"), 10, 64)
	if err != nil || version <= 0 {
		fail(w, http.StatusNotFound, "profile_photo_not_found")
		return
	}
	data, err := a.profile.Avatar(r.Context(), id, version)
	if err != nil {
		failProfile(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"profile-%d.jpg\"", id))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "profile.jpg", time.Time{}, bytes.NewReader(data))
}
