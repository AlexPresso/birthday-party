package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const (
	maxGuestUploads        = 100
	maxQueuedUploads       = 1000
	maxQueuedBytes   int64 = 10 << 30
	uploadHistoryTTL       = 24 * time.Hour
)

var uploadUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type UploadJob struct {
	ID             int64   `json:"id"`
	ClientUploadID string  `json:"clientUploadId"`
	Status         string  `json:"status"`
	Filename       string  `json:"filename"`
	Kind           string  `json:"kind"`
	CreatedAt      string  `json:"createdAt"`
	ErrorCode      *string `json:"errorCode"`
	Photo          *Photo  `json:"photo"`
}

type pendingUpload struct {
	id, guestID                int64
	key, kind, format, attempt string
}

var errUploadSuperseded = errors.New("upload processing attempt was superseded")

const uploadColumns = `j.id,j.client_upload_id,j.status,j.filename,j.kind,j.created_at,j.error_code,
 p.id,g.id,g.name,p.width,p.height,p.created_at,p.mime`

func scanUpload(row interface{ Scan(...any) error }) (UploadJob, error) {
	var job UploadJob
	var id, authorID, width, height sql.NullInt64
	var authorName, createdAt, mime sql.NullString
	err := row.Scan(&job.ID, &job.ClientUploadID, &job.Status, &job.Filename, &job.Kind, &job.CreatedAt, &job.ErrorCode,
		&id, &authorID, &authorName, &width, &height, &createdAt, &mime)
	if id.Valid {
		job.Photo = &Photo{ID: id.Int64, Author: Author{ID: authorID.Int64, Name: authorName.String}, Width: int(width.Int64), Height: int(height.Int64), CreatedAt: createdAt.String, MimeType: mime.String}
		job.Photo.urls()
	}
	return job, err
}

func (a *App) uploadByID(ctx context.Context, id, guestID int64) (UploadJob, error) {
	return scanUpload(a.db.QueryRowContext(ctx, `SELECT `+uploadColumns+` FROM upload_jobs j LEFT JOIN photos p ON p.id=j.photo_id LEFT JOIN guests g ON g.id=p.guest_id WHERE j.id=$1 AND j.guest_id=$2`, id, guestID))
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
	rows, err := a.db.QueryContext(r.Context(), `SELECT `+uploadColumns+` FROM upload_jobs j LEFT JOIN photos p ON p.id=j.photo_id LEFT JOIN guests g ON g.id=p.guest_id
 WHERE j.guest_id=$1 AND (j.status IN ('queued','processing') OR j.id IN
 (SELECT id FROM upload_jobs WHERE guest_id=$1 AND status IN ('ready','failed') AND updated_at::timestamptz >= $2::timestamptz ORDER BY id DESC LIMIT 50)) ORDER BY j.id DESC LIMIT 150`, guest.ID, stamp(a.now().Add(-uploadHistoryTTL)))
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []UploadJob{}
	for rows.Next() {
		job, err := scanUpload(rows)
		if err != nil {
			internal(w, err)
			return
		}
		items = append(items, job)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func newUploadID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	data[6] = (data[6] & 0x0f) | 0x40
	data[8] = (data[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[0:4], data[4:6], data[6:8], data[8:10], data[10:16]), nil
}

func (a *App) uploadPhoto(w http.ResponseWriter, r *http.Request, guest Guest) {
	clientID := strings.ToLower(r.Header.Get("X-Upload-ID"))
	if clientID != "" && !uploadUUID.MatchString(clientID) {
		fail(w, 400, "invalid_upload_id")
		return
	}
	if clientID != "" {
		var id int64
		err := a.db.QueryRowContext(r.Context(), "SELECT id FROM upload_jobs WHERE guest_id=$1 AND client_upload_id=$2", guest.ID, clientID).Scan(&id)
		if err == nil {
			job, err := a.uploadByID(r.Context(), id, guest.ID)
			if err != nil {
				internal(w, err)
				return
			}
			respond(w, 202, job)
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			internal(w, err)
			return
		}
	} else {
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
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "photo_required")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		fail(w, 400, "photo_required")
		return
	}
	filename := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, part.FileName())
	filename = string([]rune(filename)[:min(len([]rune(filename)), 240)])
	if filename == "" {
		filename = "media"
	}
	input, err := os.CreateTemp(filepath.Join(a.config.DataDir, "tmp"), "receive-")
	if err != nil {
		internal(w, err)
		return
	}
	defer func() { input.Close(); os.Remove(input.Name()) }()
	header := make([]byte, 512)
	n, readErr := io.ReadFull(part, header)
	header = header[:n]
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		fail(w, 400, "photo_upload_failed")
		return
	}
	format := detectVideoFormat(header)
	kind, limit, tooLarge := "image", a.config.MaxImageBytes, "photo_too_large"
	if format != "" {
		kind, limit, tooLarge = "video", a.config.MaxVideoBytes, "video_too_large"
	}
	size, err := io.Copy(input, io.LimitReader(io.MultiReader(bytes.NewReader(header), part), limit+1))
	if size > limit {
		fail(w, 413, tooLarge)
		return
	}
	if err != nil {
		fail(w, 400, "photo_upload_failed")
		return
	}
	if size == 0 {
		fail(w, 400, "photo_required")
		return
	}
	if _, err = reader.NextPart(); err != io.EOF {
		fail(w, 400, "single_photo_required")
		return
	}
	if kind == "image" {
		if _, err = input.Seek(0, io.SeekStart); err != nil {
			internal(w, err)
			return
		}
		config, imageFormat, decodeErr := image.DecodeConfig(input)
		if decodeErr != nil || (imageFormat != "jpeg" && imageFormat != "png" && imageFormat != "webp") {
			fail(w, 415, "unsupported_photo_type")
			return
		}
		if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxPhotoPixels {
			fail(w, 413, "photo_dimensions_too_large")
			return
		}
		format = imageFormat
	}
	if err = input.Sync(); err != nil {
		internal(w, err)
		return
	}
	if err = input.Close(); err != nil {
		internal(w, err)
		return
	}
	key, err := newToken()
	if err != nil {
		internal(w, err)
		return
	}
	inputPath := filepath.Join(a.config.DataDir, "uploads", key+".input")
	retained := false
	defer func() {
		if !retained {
			os.Remove(inputPath)
		}
	}()
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	// Serialize quota reservations across receivers, without holding a lock while reading files.
	if _, err = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		internal(w, err)
		return
	}
	var existing int64
	err = tx.QueryRowContext(r.Context(), "SELECT id FROM upload_jobs WHERE guest_id=$1 AND client_upload_id=$2", guest.ID, clientID).Scan(&existing)
	if err == nil {
		tx.Rollback()
		job, err := a.uploadByID(r.Context(), existing, guest.ID)
		if err != nil {
			internal(w, err)
			return
		}
		respond(w, 202, job)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		internal(w, err)
		return
	}
	var active int
	if err = tx.QueryRowContext(r.Context(), "SELECT active FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&active); err != nil {
		internal(w, err)
		return
	}
	if active != 1 {
		fail(w, 401, "access_revoked")
		return
	}
	var total, owned int
	var queuedBytes int64
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*),COUNT(*) FILTER (WHERE guest_id=$1),COALESCE(SUM(byte_size),0) FROM upload_jobs WHERE status IN ('queued','processing')", guest.ID).Scan(&total, &owned, &queuedBytes); err != nil {
		internal(w, err)
		return
	}
	if total >= maxQueuedUploads || owned >= maxGuestUploads || queuedBytes+size > maxQueuedBytes {
		fail(w, 409, "upload_queue_full")
		return
	}
	if err = os.Rename(input.Name(), inputPath); err != nil {
		internal(w, err)
		return
	}
	job := UploadJob{ClientUploadID: clientID, Status: "queued", Filename: filename, Kind: kind, CreatedAt: stamp(a.now())}
	err = tx.QueryRowContext(r.Context(), `INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at) VALUES($1,$2,'queued',$3,$4,$5,$6,$7,$8,$8) RETURNING id`, guest.ID, clientID, filename, kind, format, key, size, job.CreatedAt).Scan(&job.ID)
	if err != nil {
		internal(w, err)
		return
	}
	// A lost commit response is ambiguous. Keep the spool file so a retry with the
	// same client ID can recover a committed job; startup removes unused files.
	retained = true
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 202, job)
}

func (a *App) WorkerErrors() <-chan error { return a.workerErrors }

func (a *App) reportWorkerError(err error) {
	select {
	case a.workerErrors <- err:
	default:
	}
	a.workerMu.Lock()
	if a.workerCancel != nil {
		a.workerCancel()
	}
	a.workerMu.Unlock()
}

// StartWorkers belongs to the serving process; invitation and migration commands never process uploads.
func (a *App) StartWorkers(parent context.Context) error {
	a.workerMu.Lock()
	defer a.workerMu.Unlock()
	if a.workerCancel != nil {
		return errors.New("media workers already started")
	}
	conn, err := a.db.Conn(parent)
	if err != nil {
		return err
	}
	var locked bool
	if err = conn.QueryRowContext(parent, "SELECT pg_try_advisory_lock(hashtext(current_schema()),73002)").Scan(&locked); err != nil || !locked {
		conn.Close()
		if err != nil {
			return err
		}
		return errors.New("another media worker process is already running")
	}
	failStart := func(err error) error {
		conn.ExecContext(context.Background(), "SELECT pg_advisory_unlock(hashtext(current_schema()),73002)")
		conn.Close()
		return err
	}
	// Recovery shares the same lock order as reception, claims and publication.
	// No process may publish a file while its database references are being scanned.
	recovery, err := a.db.BeginTx(parent, nil)
	if err != nil {
		return failStart(err)
	}
	defer recovery.Rollback()
	if _, err = recovery.ExecContext(parent, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		return failStart(err)
	}
	if _, err = recovery.ExecContext(parent, "UPDATE upload_jobs SET status='queued',updated_at=$1 WHERE status='processing'", stamp(a.now())); err != nil {
		return failStart(err)
	}
	if err = a.recoverUploadFiles(parent); err != nil {
		return failStart(err)
	}
	if err = recovery.Commit(); err != nil {
		return failStart(err)
	}
	ctx, cancel := context.WithCancel(parent)
	a.workerCancel = cancel
	a.workerConn = conn
	for range 2 {
		a.workers.Add(1)
		go func() { defer a.workers.Done(); a.mediaWorker(ctx) }()
	}
	a.workers.Add(1)
	go func() {
		defer a.workers.Done()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		lastCleanup := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				check, cancelCheck := context.WithTimeout(ctx, 5*time.Second)
				err := conn.PingContext(check)
				cancelCheck()
				if err != nil {
					if ctx.Err() == nil {
						a.reportWorkerError(fmt.Errorf("media worker lock connection lost: %w", err))
					}
					cancel()
					return
				}
				if time.Since(lastCleanup) >= time.Minute {
					if err := a.cleanUploadHistory(ctx); err != nil && ctx.Err() == nil {
						log.Printf("clean upload history: %v", err)
					}
					lastCleanup = time.Now()
				}
			}
		}
	}()
	return nil
}

func (a *App) recoverUploadFiles(ctx context.Context) error {
	rows, err := a.db.QueryContext(ctx, "SELECT storage_key FROM upload_jobs WHERE status IN ('queued','processing')")
	if err != nil {
		return err
	}
	active := map[string]bool{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		active[key+".input"] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	files, err := os.ReadDir(filepath.Join(a.config.DataDir, "uploads"))
	if err != nil {
		return err
	}
	for _, file := range files {
		if !active[file.Name()] && !file.IsDir() {
			if err = os.Remove(filepath.Join(a.config.DataDir, "uploads", file.Name())); err != nil {
				return err
			}
		}
	}
	files, err = os.ReadDir(filepath.Join(a.config.DataDir, "tmp"))
	if err != nil {
		return err
	}
	for _, file := range files {
		if err = os.RemoveAll(filepath.Join(a.config.DataDir, "tmp", file.Name())); err != nil {
			return err
		}
	}
	// A crash between writing playback files and committing their row can leave orphans.
	rows, err = a.db.QueryContext(ctx, "SELECT filename,thumbnail FROM photos")
	if err != nil {
		return err
	}
	referenced := map[string]bool{}
	for rows.Next() {
		var filename, thumbnail string
		if err = rows.Scan(&filename, &thumbnail); err != nil {
			rows.Close()
			return err
		}
		referenced[filename], referenced[thumbnail] = true, true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	files, err = os.ReadDir(filepath.Join(a.config.DataDir, "photos"))
	if err != nil {
		return err
	}
	for _, file := range files {
		if !file.IsDir() && !referenced[file.Name()] {
			if err = os.Remove(filepath.Join(a.config.DataDir, "photos", file.Name())); err != nil {
				return err
			}
		}
	}
	return a.cleanUploadHistory(ctx)
}

func (a *App) cleanUploadHistory(ctx context.Context) error {
	_, err := a.db.ExecContext(ctx, "DELETE FROM upload_jobs WHERE status IN ('ready','failed') AND updated_at::timestamptz<$1::timestamptz", stamp(a.now().Add(-uploadHistoryTTL)))
	return err
}

func (a *App) claimUpload(ctx context.Context) (pendingUpload, error) {
	var job pendingUpload
	attempt, err := newUploadID()
	if err != nil {
		return job, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return job, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		return job, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE upload_jobs SET status='processing',updated_at=$1,attempt_id=$2 WHERE id=(SELECT id FROM upload_jobs WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,guest_id,storage_key,kind,input_format,attempt_id`, stamp(a.now()), attempt).Scan(&job.id, &job.guestID, &job.key, &job.kind, &job.format, &job.attempt)
	if err != nil {
		return job, err
	}
	return job, tx.Commit()
}

func (a *App) mediaWorker(ctx context.Context) {
	for ctx.Err() == nil {
		job, err := a.claimUpload(ctx)
		if err == nil {
			a.processUpload(ctx, job)
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
			// The UPDATE may have committed before its RETURNING response was lost.
			// Restart to recover that processing row instead of silently abandoning it.
			a.reportWorkerError(fmt.Errorf("claim media upload: %w", err))
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(300 * time.Millisecond):
		}
	}
}

func (a *App) processUpload(ctx context.Context, job pendingUpload) {
	err := a.prepareAndStoreUpload(ctx, job)
	if errors.Is(err, errUploadSuperseded) {
		return
	}
	if err == nil {
		os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
		return
	}
	// Retain raw input on shutdown or infrastructure errors; a later attempt can finish it.
	var validation *mediaValidationError
	terminal := errors.As(err, &validation)
	if !terminal && errors.Is(err, os.ErrNotExist) {
		validation = &mediaValidationError{404, "photo_unavailable"}
		terminal = true
	}
	updateCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if ctx.Err() != nil || !terminal {
		if ctx.Err() == nil {
			log.Printf("process media upload %d: %v", job.id, err)
		}
		var status string
		if a.db.QueryRowContext(updateCtx, "SELECT status FROM upload_jobs WHERE id=$1", job.id).Scan(&status) == nil && status == "ready" {
			os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
			return
		}
		result, updateErr := a.db.ExecContext(updateCtx, "UPDATE upload_jobs SET status='queued',updated_at=$1 WHERE id=$2 AND status='processing' AND attempt_id=$3", stamp(a.now()), job.id, job.attempt)
		if updateErr != nil {
			if ctx.Err() == nil {
				a.reportWorkerError(fmt.Errorf("requeue media upload %d: %w", job.id, updateErr))
			}
		}
		if updateErr == nil {
			if count, _ := result.RowsAffected(); count > 0 {
				a.removeAttemptOutputs(job)
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
		return
	}
	result, updateErr := a.db.ExecContext(updateCtx, "UPDATE upload_jobs SET status='failed',error_code=$1,updated_at=$2 WHERE id=$3 AND status='processing' AND attempt_id=$4", validation.code, stamp(a.now()), job.id, job.attempt)
	if updateErr != nil {
		if ctx.Err() == nil {
			a.reportWorkerError(fmt.Errorf("fail media upload %d: %w", job.id, updateErr))
		}
		return
	}
	if count, _ := result.RowsAffected(); count > 0 {
		os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input"))
	}
	a.removeAttemptOutputs(job)
}

func (a *App) removeAttemptOutputs(job pendingUpload) {
	for _, suffix := range []string{".jpg", ".png", ".webp", ".mp4", ".thumb.jpg"} {
		os.Remove(filepath.Join(a.config.DataDir, "photos", job.key+"-"+job.attempt+suffix))
	}
}

func (a *App) prepareAndStoreUpload(ctx context.Context, job pendingUpload) error {
	inputPath := filepath.Join(a.config.DataDir, "uploads", job.key+".input")
	workDir, err := os.MkdirTemp(filepath.Join(a.config.DataDir, "tmp"), "process-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workDir)
	var media preparedMedia
	if job.kind == "video" {
		media, err = prepareVideo(ctx, inputPath, workDir, job.format, a.config.MaxVideoBytes)
	} else {
		input, openErr := os.Open(inputPath)
		if openErr != nil {
			return openErr
		}
		media, err = prepareImage(input, filepath.Join(workDir, "thumb.jpg"))
		input.Close()
	}
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	info, err := os.Stat(media.path)
	if err != nil {
		return err
	}
	thumbInfo, err := os.Stat(media.thumbnailPath)
	if err != nil {
		return err
	}
	filename, thumbname := job.key+"-"+job.attempt+"."+media.extension, job.key+"-"+job.attempt+".thumb.jpg"
	finalPath, finalThumb := filepath.Join(a.config.DataDir, "photos", filename), filepath.Join(a.config.DataDir, "photos", thumbname)
	committed := false
	defer func() {
		if !committed {
			os.Remove(finalPath)
			os.Remove(finalThumb)
		}
	}()
	// Copy outside the quota transaction so large files do not delay other receivers.
	// The original remains available until both metadata and job status commit.
	if err = copyPrivateFile(media.path, finalPath); err != nil {
		return err
	}
	if err = copyPrivateFile(media.thumbnailPath, finalThumb); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		return err
	}
	var status, attempt string
	if err = tx.QueryRowContext(ctx, "SELECT status,COALESCE(attempt_id,'') FROM upload_jobs WHERE id=$1 FOR UPDATE", job.id).Scan(&status, &attempt); err != nil {
		return err
	}
	if status != "processing" || attempt != job.attempt {
		return errUploadSuperseded
	}
	var active int
	if err = tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1 FOR UPDATE", job.guestID).Scan(&active); err != nil {
		return err
	}
	if active != 1 {
		return &mediaValidationError{401, "access_revoked"}
	}
	var count int
	var stored int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM photos").Scan(&count, &stored); err != nil {
		return err
	}
	if count >= 5000 || stored+info.Size()+thumbInfo.Size() > maxStoredPhotoBytes {
		return &mediaValidationError{409, "album_full"}
	}
	var photoID int64
	err = tx.QueryRowContext(ctx, `INSERT INTO photos(guest_id,filename,thumbnail,mime,width,height,byte_size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, job.guestID, filename, thumbname, media.mimeType, media.width, media.height, info.Size()+thumbInfo.Size(), stamp(a.now())).Scan(&photoID)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE upload_jobs SET status='ready',photo_id=$1,updated_at=$2 WHERE id=$3", photoID, stamp(a.now()), job.id); err != nil {
		return err
	}
	// Commit errors can mean PostgreSQL committed but the response was lost.
	// Retain output in that case; a retry replaces it or startup removes orphans.
	committed = true
	if err = tx.Commit(); err != nil {
		return err
	}
	return nil
}

func copyPrivateFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	if copyErr == nil {
		copyErr = out.Sync()
	}
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
