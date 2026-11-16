package app

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/adapters/voicenote"
)

// voiceBodyLimit bounds the message sent with a voice note: 2,000 characters
// of up to four bytes.
const voiceBodyLimit = 8 << 10

func (a *App) listEntries(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	items, err := a.guestbook.List(r.Context(), viewer.Guest, before, limit)
	if err != nil {
		failError(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, http.StatusOK, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) createEntry(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	if mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType == "multipart/form-data" {
		a.createVoiceEntry(w, r, viewer)
		return
	}
	var input struct {
		Body      string `json:"body"`
		Anonymous bool   `json:"anonymous"`
	}
	if !decode(w, r, &input) {
		return
	}
	entry, err := a.guestbook.Create(r.Context(), viewer.Guest, input.Body, input.Anonymous, a.now())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusCreated, entry)
}

// createVoiceEntry reads a multipart form whose "body" field comes before its
// "audio" file, so the recording streams straight to the encoder.
func (a *App) createVoiceEntry(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	limit := int64(voicenote.MaxInputBytes + multipartOverhead)
	release, ok := a.acquireReceiver(w, r, viewer.Guest.ID, limit)
	if !ok {
		return
	}
	defer release()
	boundReception(w, r, limit)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, "invalid_voice_note")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "body" {
		fail(w, "invalid_voice_note")
		return
	}
	body, err := io.ReadAll(io.LimitReader(part, voiceBodyLimit+1))
	if err != nil || len(body) > voiceBodyLimit {
		fail(w, "invalid_message")
		return
	}
	part, err = reader.NextPart()
	if err != nil || part.FormName() != "audio" {
		fail(w, "invalid_voice_note")
		return
	}
	voice, err := a.voiceNotes.Encode(r.Context(), part)
	var tooLarge *http.MaxBytesError
	if errors.Is(err, voicenote.ErrTooLarge) || errors.As(err, &tooLarge) {
		fail(w, "voice_note_too_large")
		return
	}
	if err != nil {
		failError(w, err)
		return
	}
	// Encoding follows the transfer; leave time to answer after it.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(responseWriteTimeout))
	entry, err := a.guestbook.CreateVoice(r.Context(), viewer.Guest, strings.ToValidUTF8(string(body), "�"), voice, a.now())
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusCreated, entry)
}

// serveVoice answers ranges, as browsers request audio in pieces. A voice note
// never changes, so its entry names its validator.
func (a *App) serveVoice(w http.ResponseWriter, r *http.Request, _ access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	audio, err := a.guestbook.VoiceAudio(r.Context(), id)
	if err != nil {
		failError(w, err)
		return
	}
	w.Header().Set("Content-Type", "audio/mp4")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", `"voice-`+strconv.FormatInt(id, 10)+`"`)
	allowDownload(w, int64(len(audio)))
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(audio))
}

func (a *App) deleteEntry(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	deleted, err := a.guestbook.Delete(r.Context(), id, viewer.Guest)
	if err != nil {
		failError(w, err)
		return
	}
	if !deleted {
		fail(w, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
