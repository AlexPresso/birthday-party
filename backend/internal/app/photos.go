package app

import (
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const maxPhotoBytes = 15 << 20
const maxPhotoPixels = 40_000_000
const maxStoredPhotoBytes = 10 << 30

type Photo struct {
	ID           int64  `json:"id"`
	Author       Author `json:"author"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	CreatedAt    string `json:"createdAt"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl"`
}

func (p *Photo) urls() {
	p.URL = "/api/photos/" + strconv.FormatInt(p.ID, 10) + "/image"
	p.ThumbnailURL = p.URL + "?size=thumb"
}

func (a *App) listPhotos(w http.ResponseWriter, r *http.Request, _ Guest) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT p.id,g.id,g.name,p.width,p.height,p.created_at FROM photos p JOIN guests g ON p.guest_id=g.id WHERE (?=0 OR p.id<?) ORDER BY p.id DESC LIMIT ?`, before, before, limit+1)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Photo{}
	for rows.Next() {
		var photo Photo
		if err := rows.Scan(&photo.ID, &photo.Author.ID, &photo.Author.Name, &photo.Width, &photo.Height, &photo.CreatedAt); err != nil {
			internal(w, err)
			return
		}
		photo.urls()
		items = append(items, photo)
	}
	if err := rows.Err(); err != nil {
		internal(w, err)
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		next = cursor(items[len(items)-1].ID)
	}
	respond(w, 200, map[string]any{"items": items, "nextCursor": next})
}

func (a *App) uploadPhoto(w http.ResponseWriter, r *http.Request, guest Guest) {
	select {
	case a.uploads <- struct{}{}:
		defer func() { <-a.uploads }()
	default:
		w.Header().Set("Retry-After", "2")
		fail(w, 429, "upload_busy")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+(64<<10))
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "photo_required")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		fail(w, 400, "single_photo_required")
		return
	}
	temp, err := os.CreateTemp(filepath.Join(a.config.DataDir, "tmp"), "upload-*")
	if err != nil {
		internal(w, err)
		return
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	size, err := io.Copy(temp, io.LimitReader(part, maxPhotoBytes+1))
	if size > maxPhotoBytes {
		fail(w, 413, "photo_too_large")
		return
	}
	if err != nil {
		fail(w, 400, "photo_upload_failed")
		return
	}
	if _, err = reader.NextPart(); err != io.EOF {
		fail(w, 400, "single_photo_required")
		return
	}
	if _, err = temp.Seek(0, io.SeekStart); err != nil {
		internal(w, err)
		return
	}
	config, format, err := image.DecodeConfig(temp)
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		fail(w, 415, "unsupported_photo_type")
		return
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPhotoPixels {
		fail(w, 413, "photo_dimensions_too_large")
		return
	}
	if _, err = temp.Seek(0, io.SeekStart); err != nil {
		internal(w, err)
		return
	}
	// imaging applies the EXIF orientation so phone thumbnails match originals.
	decoded, err := imaging.Decode(temp, imaging.AutoOrientation(true))
	if err != nil {
		fail(w, 415, "unreadable_photo")
		return
	}
	if r.Context().Err() != nil {
		return
	}
	thumbnail := imaging.Fit(decoded, 720, 720, imaging.Linear)
	// Composite transparent PNG/WebP pixels onto the app's dark plum background.
	flat := image.NewRGBA(thumbnail.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.RGBA{R: 32, G: 19, B: 31, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumbnail, thumbnail.Bounds().Min, draw.Over)
	key, err := newToken()
	if err != nil {
		internal(w, err)
		return
	}
	extension := map[string]string{"jpeg": "jpg", "png": "png", "webp": "webp"}[format]
	filename, thumbname := key+"."+extension, key+"-thumb.jpg"
	originalPath := filepath.Join(a.config.DataDir, "photos", filename)
	thumbPath := filepath.Join(a.config.DataDir, "photos", thumbname)
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(originalPath)
			_ = os.Remove(thumbPath)
		}
	}()
	thumb, err := os.OpenFile(thumbPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		internal(w, err)
		return
	}
	encodeErr := jpeg.Encode(thumb, flat, &jpeg.Options{Quality: 82})
	closeErr := thumb.Close()
	if encodeErr != nil {
		internal(w, encodeErr)
		return
	}
	if closeErr != nil {
		internal(w, closeErr)
		return
	}
	if err = temp.Close(); err != nil {
		internal(w, err)
		return
	}
	if err = os.Rename(temp.Name(), originalPath); err != nil {
		internal(w, err)
		return
	}
	photo := Photo{Author: Author{ID: guest.ID, Name: guest.Name}, Width: decoded.Bounds().Dx(), Height: decoded.Bounds().Dy(), CreatedAt: stamp(a.now())}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	var stored int64
	var count int
	if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM photos").Scan(&count, &stored); err != nil {
		internal(w, err)
		return
	}
	if count >= 5000 || stored+size > maxStoredPhotoBytes {
		fail(w, 409, "album_full")
		return
	}
	// Recheck active status after expensive image processing, so revocation wins.
	var active bool
	if err := tx.QueryRowContext(r.Context(), "SELECT active FROM guests WHERE id=?", guest.ID).Scan(&active); err != nil {
		internal(w, err)
		return
	}
	if !active {
		fail(w, 401, "access_revoked")
		return
	}
	result, err := tx.ExecContext(r.Context(), "INSERT INTO photos(guest_id,width,height,created_at,filename,thumbnail,mime,byte_size) VALUES(?,?,?,?,?,?,?,?)", guest.ID, photo.Width, photo.Height, photo.CreatedAt, filename, thumbname, "image/"+format, size)
	if err != nil {
		internal(w, err)
		return
	}
	photo.ID, err = result.LastInsertId()
	if err != nil {
		internal(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	committed = true
	photo.urls()
	respond(w, 201, photo)
}

func (a *App) servePhoto(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var filename, thumbname, mime string
	err := a.db.QueryRowContext(r.Context(), "SELECT filename,thumbnail,mime FROM photos WHERE id=?", id).Scan(&filename, &thumbname, &mime)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "photo_not_found")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	if r.URL.Query().Get("size") == "thumb" {
		filename, mime = thumbname, "image/jpeg"
	}
	file, err := os.Open(filepath.Join(a.config.DataDir, "photos", filename))
	if errors.Is(err, os.ErrNotExist) {
		fail(w, 404, "photo_unavailable")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"photo-%d.%s\"", id, filepath.Ext(filename)[1:]))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, filename, time.Time{}, file)
}

func (a *App) deletePhoto(w http.ResponseWriter, r *http.Request, guest Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var author int64
	var filename, thumbname string
	err := a.db.QueryRowContext(r.Context(), "SELECT guest_id,filename,thumbnail FROM photos WHERE id=?", id).Scan(&author, &filename, &thumbname)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "photo_not_found")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	if guest.ID != author && guest.Role != "admin" {
		fail(w, 403, "photo_delete_forbidden")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM photos WHERE id=?", id)
	if !affected(w, result, err) {
		return
	}
	for _, name := range []string{filename, thumbname} {
		if err := os.Remove(filepath.Join(a.config.DataDir, "photos", name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("remove private photo %d: %v", id, err)
		}
	}
	w.WriteHeader(204)
}
