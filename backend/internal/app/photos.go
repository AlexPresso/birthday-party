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
	"strings"
	"time"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const maxPhotoPixels = 40_000_000
const maxStoredPhotoBytes = 10 << 30

type preparedMedia struct {
	path, thumbnailPath, mimeType, extension string
	width, height                            int
}

type mediaValidationError struct {
	status int
	code   string
}

func (e *mediaValidationError) Error() string { return e.code }

func prepareImage(input *os.File, thumbnailPath string) (preparedMedia, error) {
	config, format, err := image.DecodeConfig(input)
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return preparedMedia{}, &mediaValidationError{415, "unsupported_photo_type"}
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPhotoPixels {
		return preparedMedia{}, &mediaValidationError{413, "photo_dimensions_too_large"}
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return preparedMedia{}, err
	}
	// Apply phone EXIF orientation, then flatten transparency onto dark plum.
	decoded, err := imaging.Decode(input, imaging.AutoOrientation(true))
	if err != nil {
		return preparedMedia{}, &mediaValidationError{415, "unreadable_photo"}
	}
	thumbnail := imaging.Fit(decoded, 720, 720, imaging.Linear)
	flat := image.NewRGBA(thumbnail.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.RGBA{R: 32, G: 19, B: 31, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumbnail, thumbnail.Bounds().Min, draw.Over)
	thumb, err := os.OpenFile(thumbnailPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return preparedMedia{}, err
	}
	encodeErr := jpeg.Encode(thumb, flat, &jpeg.Options{Quality: 82})
	closeErr := thumb.Close()
	if encodeErr != nil {
		return preparedMedia{}, encodeErr
	}
	if closeErr != nil {
		return preparedMedia{}, closeErr
	}
	return preparedMedia{
		path: input.Name(), thumbnailPath: thumbnailPath, mimeType: "image/" + format,
		extension: map[string]string{"jpeg": "jpg", "png": "png", "webp": "webp"}[format],
		width:     decoded.Bounds().Dx(), height: decoded.Bounds().Dy(),
	}, nil
}

// Photo describes published media with URLs that require an active guest session.
type Photo struct {
	ID           int64  `json:"id"`
	Author       Author `json:"author"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	CreatedAt    string `json:"createdAt"`
	URL          string `json:"url"`
	ThumbnailURL string `json:"thumbnailUrl"`
	Kind         string `json:"kind"`
	MIMEType     string `json:"mimeType"`
}

func (p *Photo) urls() {
	p.Kind = "image"
	if strings.HasPrefix(p.MIMEType, "video/") {
		p.Kind = "video"
	}
	p.URL = "/api/photos/" + strconv.FormatInt(p.ID, 10) + "/image"
	p.ThumbnailURL = p.URL + "?size=thumb"
}

func (a *App) listPhotos(w http.ResponseWriter, r *http.Request, _ Guest) {
	before, limit, ok := page(w, r)
	if !ok {
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT p.id,g.id,g.name,p.width,p.height,p.created_at,p.mime FROM photos p JOIN guests g ON p.guest_id=g.id WHERE ($1::bigint=0 OR p.id<$1) ORDER BY p.id DESC LIMIT $2`, before, limit+1)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Photo{}
	for rows.Next() {
		var photo Photo
		if err := rows.Scan(&photo.ID, &photo.Author.ID, &photo.Author.Name, &photo.Width, &photo.Height, &photo.CreatedAt, &photo.MIMEType); err != nil {
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
	respond(w, 200, map[string]any{
		"items": items, "nextCursor": next,
		"limits": map[string]int64{"imageBytes": a.config.MaxImageBytes, "videoBytes": a.config.MaxVideoBytes},
	})
}

func (a *App) servePhoto(w http.ResponseWriter, r *http.Request, _ Guest) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var filename, thumbname, mime string
	err := a.db.QueryRowContext(r.Context(), "SELECT filename,thumbnail,mime FROM photos WHERE id=$1", id).Scan(&filename, &thumbname, &mime)
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
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"media-%d.%s\"", id, filepath.Ext(filename)[1:]))
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
	err := a.db.QueryRowContext(r.Context(), "SELECT guest_id,filename,thumbnail FROM photos WHERE id=$1", id).Scan(&author, &filename, &thumbname)
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
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM photos WHERE id=$1", id)
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
