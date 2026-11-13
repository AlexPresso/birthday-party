package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"

	"birthday-party/backend/internal/access"
)

func (a *App) listPhotos(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	categoryID, err := requestedCategory(r)
	if err != nil {
		failError(w, err)
		return
	}
	items, err := a.media.Photos(r.Context(), viewer.Guest, categoryID, before, limit)
	if err != nil {
		failError(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, map[string]any{"items": items, "nextCursor": next, "limits": limits})
}

func (a *App) servePhoto(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	metadata, err := a.media.PhotoFile(r.Context(), viewer.Guest, id)
	if err != nil {
		failError(w, err)
		return
	}
	filename, mime := metadata.Filename, metadata.MIME
	if r.URL.Query().Get("size") == "thumb" {
		filename, mime = metadata.Thumbnail, "image/jpeg"
	}
	file, err := a.media.OpenPublished(filename)
	if err != nil {
		failError(w, err)
		return
	}
	defer file.Close()
	size, err := file.Seek(0, io.SeekEnd)
	if err == nil {
		_, err = file.Seek(0, io.SeekStart)
	}
	if err != nil {
		failError(w, err)
		return
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Type", mime)
	// Stored names always carry an extension; a missing one must not break delivery.
	w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename=\"media-%d%s\"", disposition, id, filepath.Ext(filename)))
	// A stored file never changes and its private name is unique, so the name
	// identifies the content without reading it.
	revalidateMedia(w, strongETag([]byte(filename)))
	allowDownload(w, size)
	http.ServeContent(w, r, "", metadata.Created, file)
}

func (a *App) deletePhoto(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := a.media.DeletePhoto(r.Context(), viewer.Guest, id); err != nil {
		failError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// revalidateMedia lets the browser keep an authorized media response but
// requires it to ask again before every reuse. The request for a cached copy
// therefore passes the same session, welcome and visibility checks as a full
// download, and only then is a matching validator answered with 304.
func revalidateMedia(w http.ResponseWriter, etag string) {
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)
}

// strongETag derives a validator from bytes that identify one exact content.
func strongETag(identity []byte) string {
	digest := sha256.Sum256(identity)
	return `"` + hex.EncodeToString(digest[:16]) + `"`
}
