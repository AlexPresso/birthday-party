package app

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/disintegration/imaging"
)

const maxAvatarBytes = 128 << 10

func avatarURL(id, version int64) *string {
	if version <= 0 {
		return nil
	}
	value := fmt.Sprintf("/api/guests/%d/avatar?v=%d", id, version)
	return &value
}

func (a *App) getProfile(w http.ResponseWriter, _ *http.Request, guest Guest) {
	a.respondProfile(w, guest)
}

func (a *App) respondProfile(w http.ResponseWriter, guest Guest) {
	respond(w, http.StatusOK, map[string]any{
		"guest":  guest,
		"limits": map[string]int64{"imageBytes": a.config.MaxImageBytes},
	})
}

func (a *App) updateAvatar(w http.ResponseWriter, r *http.Request, guest Guest) {
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
		failUpload(w, err)
		return
	}
	cookie, _ := r.Cookie(cookieName)
	updated, err := a.saveAvatar(r.Context(), guest.ID, hashToken(cookie.Value), data)
	if err != nil {
		failUpload(w, err)
		return
	}
	a.respondProfile(w, updated)
}

func (a *App) deleteAvatar(w http.ResponseWriter, r *http.Request, guest Guest) {
	cookie, _ := r.Cookie(cookieName)
	updated, err := a.saveAvatar(r.Context(), guest.ID, hashToken(cookie.Value), nil)
	if err != nil {
		failUpload(w, err)
		return
	}
	a.respondProfile(w, updated)
}

func (a *App) receiveAvatar(r *http.Request) ([]byte, error) {
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, &mediaValidationError{400, "profile_photo_required"}
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		return nil, &mediaValidationError{400, "profile_photo_required"}
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
		return nil, &mediaValidationError{413, "photo_too_large"}
	}
	if err != nil {
		return nil, &mediaValidationError{400, "photo_upload_failed"}
	}
	if count == 0 {
		return nil, &mediaValidationError{400, "profile_photo_required"}
	}
	if _, err = reader.NextPart(); err != io.EOF {
		return nil, &mediaValidationError{400, "single_photo_required"}
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return prepareAvatar(r.Context(), input)
}

func prepareAvatar(ctx context.Context, input io.ReadSeeker) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	config, format, err := image.DecodeConfig(input)
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, &mediaValidationError{415, "unsupported_profile_photo_type"}
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPhotoPixels {
		return nil, &mediaValidationError{413, "photo_dimensions_too_large"}
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	decoded, err := imaging.Decode(input, imaging.AutoOrientation(true))
	if err != nil {
		return nil, &mediaValidationError{415, "unreadable_photo"}
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	// Crop before resizing so narrow images cannot create oversized intermediate
	// allocations when scaled to fill the square.
	side := min(decoded.Bounds().Dx(), decoded.Bounds().Dy())
	square := imaging.CropCenter(decoded, side, side)
	thumbnail := imaging.Resize(square, 256, 256, imaging.Linear)
	flat := image.NewRGBA(thumbnail.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.RGBA{R: 32, G: 19, B: 31, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumbnail, thumbnail.Bounds().Min, draw.Over)
	var encoded bytes.Buffer
	// Re-encoding only pixels strips EXIF and other original metadata.
	if err = jpeg.Encode(&encoded, flat, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	if encoded.Len() > maxAvatarBytes {
		return nil, errors.New("normalized avatar exceeded its storage limit")
	}
	return encoded.Bytes(), ctx.Err()
}

func (a *App) saveAvatar(ctx context.Context, guestID int64, sessionHash string, data []byte) (Guest, error) {
	var guest Guest
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return guest, err
	}
	defer tx.Rollback()
	// Follow media acceptance's guest-then-welcome lock order. Recheck the
	// session too, because logout, revocation or closing access can finish
	// while an image is being received and decoded.
	err = tx.QueryRowContext(ctx, "SELECT id,name,role,active FROM guests WHERE id=$1 FOR UPDATE", guestID).Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active)
	if err != nil {
		return guest, err
	}
	if !guest.Active {
		return guest, &mediaValidationError{401, "access_revoked"}
	}
	var sessionGuestID int64
	err = tx.QueryRowContext(ctx, "SELECT guest_id FROM sessions WHERE token_hash=$1 AND guest_id=$2 AND expires_at>$3 FOR SHARE", sessionHash, guestID, a.now().Unix()).Scan(&sessionGuestID)
	if errors.Is(err, sql.ErrNoRows) {
		return guest, &mediaValidationError{401, "session_expired"}
	}
	if err != nil {
		return guest, err
	}
	view, err := currentGuestWelcome(ctx, tx, guestID)
	if err != nil {
		return guest, err
	}
	profileWidget := false
	if view.Step != nil {
		for _, widget := range view.Step.Widgets {
			profileWidget = profileWidget || widget.Type == "profile_photo"
		}
	}
	if guest.Role != "admin" && !view.Open && !profileWidget {
		return guest, &mediaValidationError{http.StatusLocked, "welcome_required"}
	}
	var version int64
	// At most 128 KiB per guest keeps atomic PostgreSQL storage small and avoids
	// orphaned files on replacement, rollback or process interruption.
	err = tx.QueryRowContext(ctx, "UPDATE guests SET avatar_jpeg=$1,avatar_version=avatar_version+1 WHERE id=$2 RETURNING avatar_version", data, guestID).Scan(&version)
	if err != nil {
		return guest, err
	}
	if data != nil {
		guest.AvatarURL = avatarURL(guest.ID, version)
	}
	return guest, tx.Commit()
}

func (a *App) serveAvatar(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	version, err := strconv.ParseInt(r.URL.Query().Get("v"), 10, 64)
	if err != nil || version <= 0 {
		fail(w, http.StatusNotFound, "profile_photo_not_found")
		return
	}
	var data []byte
	err = a.db.QueryRowContext(r.Context(), "SELECT avatar_jpeg FROM guests WHERE id=$1 AND avatar_version=$2 AND avatar_jpeg IS NOT NULL", id, version).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusNotFound, "profile_photo_not_found")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"profile-%d.jpg\"", id))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "profile.jpg", time.Time{}, bytes.NewReader(data))
}
