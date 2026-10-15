package app

import (
	"bytes"
	"database/sql"
	"errors"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

var uploadUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type receivedUpload struct {
	path, filename, kind, format string
	size                         int64
}

func (a *App) getUpload(w http.ResponseWriter, r *http.Request, guest Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	job, err := a.uploadByID(r.Context(), id, guest.ID)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "upload_not_found")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, job)
}

func (a *App) listUploads(w http.ResponseWriter, r *http.Request, guest Guest) {
	items, err := a.recentUploads(r.Context(), guest.ID)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) uploadPhoto(w http.ResponseWriter, r *http.Request, guest Guest) {
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
	existing, err := a.inspectUpload(r.Context(), guest.ID, clientID, &destination)
	if err != nil {
		failUpload(w, err)
		return
	}
	if existing != nil {
		respond(w, 202, existing)
		return
	}
	if clientID == "" {
		var err error
		clientID, err = newUploadID()
		if err != nil {
			internal(w, err)
			return
		}
	}
	// Reception has its own bounded slots; conversion never holds these slots.
	select {
	case a.receivers <- struct{}{}:
		defer func() { <-a.receivers }()
	case <-r.Context().Done():
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, max(a.config.MaxImageBytes, a.config.MaxVideoBytes)+(64<<10))
	upload, err := a.receiveUpload(r)
	if err != nil {
		failUpload(w, err)
		return
	}
	defer os.Remove(upload.path)
	job, err := a.enqueueUpload(r.Context(), guest.ID, clientID, upload, destination)
	if err != nil {
		failUpload(w, err)
		return
	}
	respond(w, 202, job)
}

func failUpload(w http.ResponseWriter, err error) {
	var validation *mediaValidationError
	if errors.As(err, &validation) {
		fail(w, validation.status, validation.code)
		return
	}
	internal(w, err)
}

// receiveUpload validates and durably writes one input. The caller owns its removal.
func (a *App) receiveUpload(r *http.Request) (receivedUpload, error) {
	var upload receivedUpload
	reader, err := r.MultipartReader()
	if err != nil {
		return upload, &mediaValidationError{400, "photo_required"}
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		return upload, &mediaValidationError{400, "photo_required"}
	}
	upload.filename = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, part.FileName())
	filename := []rune(upload.filename)
	upload.filename = string(filename[:min(len(filename), 240)])
	if upload.filename == "" {
		upload.filename = "media"
	}
	input, err := os.CreateTemp(filepath.Join(a.config.DataDir, "tmp"), "receive-")
	if err != nil {
		return upload, err
	}
	upload.path = input.Name()
	retained := false
	defer func() {
		input.Close()
		if !retained {
			os.Remove(upload.path)
		}
	}()
	header := make([]byte, 512)
	n, readErr := io.ReadFull(part, header)
	header = header[:n]
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return upload, &mediaValidationError{400, "photo_upload_failed"}
	}
	upload.format = detectVideoFormat(header)
	upload.kind = "image"
	limit, tooLarge := a.config.MaxImageBytes, "photo_too_large"
	if upload.format != "" {
		upload.kind, limit, tooLarge = "video", a.config.MaxVideoBytes, "video_too_large"
	}
	upload.size, err = io.Copy(input, io.LimitReader(io.MultiReader(bytes.NewReader(header), part), limit+1))
	if upload.size > limit {
		return upload, &mediaValidationError{413, tooLarge}
	}
	if err != nil {
		return upload, &mediaValidationError{400, "photo_upload_failed"}
	}
	if upload.size == 0 {
		return upload, &mediaValidationError{400, "photo_required"}
	}
	if _, err = reader.NextPart(); err != io.EOF {
		return upload, &mediaValidationError{400, "single_photo_required"}
	}
	if upload.kind == "image" {
		if _, err = input.Seek(0, io.SeekStart); err != nil {
			return upload, err
		}
		config, format, decodeErr := image.DecodeConfig(input)
		if decodeErr != nil || (format != "jpeg" && format != "png" && format != "webp") {
			return upload, &mediaValidationError{415, "unsupported_photo_type"}
		}
		if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPhotoPixels {
			return upload, &mediaValidationError{413, "photo_dimensions_too_large"}
		}
		upload.format = format
	}
	if err = input.Sync(); err != nil {
		return upload, err
	}
	if err = input.Close(); err != nil {
		return upload, err
	}
	retained = true
	return upload, nil
}
