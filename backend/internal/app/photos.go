package app

import (
	"birthday-party/backend/internal/identity"
	"fmt"
	"net/http"
	"path/filepath"
	"time"
)

func (a *App) listPhotos(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	categoryID, err := requestedCategory(r)
	if err != nil {
		failUpload(w, err)
		return
	}
	items, err := a.media.Photos(r.Context(), guest, categoryID, before, limit)
	if err != nil {
		failUpload(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, 200, map[string]any{"items": items, "nextCursor": next, "limits": map[string]int64{"imageBytes": a.config.MaxImageBytes, "videoBytes": a.config.MaxVideoBytes}})
}

func (a *App) servePhoto(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	metadata, err := a.media.PhotoFile(r.Context(), guest, id)
	if err != nil {
		failUpload(w, err)
		return
	}
	filename, mime := metadata.Filename, metadata.MIME
	if r.URL.Query().Get("size") == "thumb" {
		filename, mime = metadata.Thumbnail, "image/jpeg"
	}
	file, err := a.media.OpenPublished(filename)
	if err != nil {
		failUpload(w, err)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"media-%d.%s\"", id, filepath.Ext(filename)[1:]))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, filename, time.Time{}, file)
}

func (a *App) deletePhoto(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.media.DeletePhoto(r.Context(), guest, id); err != nil {
		failUpload(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
