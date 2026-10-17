package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	maxGuestUploads        = 100
	maxQueuedUploads       = 1000
	maxQueuedBytes   int64 = 10 << 30
	uploadHistoryTTL       = 24 * time.Hour
)

// UploadJob is the owner's view of an accepted media upload and its eventual result.
type UploadJob struct {
	ID                 int64   `json:"id"`
	ClientUploadID     string  `json:"clientUploadId"`
	Status             string  `json:"status"`
	Filename           string  `json:"filename"`
	Kind               string  `json:"kind"`
	CreatedAt          string  `json:"createdAt"`
	ErrorCode          *string `json:"errorCode"`
	Photo              *Photo  `json:"photo"`
	CategoryID         *int64  `json:"categoryId"`
	WelcomeRevision    *int64  `json:"welcomeRevision"`
	WelcomeWidgetIndex *int64  `json:"welcomeWidgetIndex"`
}

type pendingUpload struct {
	id, guestID                int64
	key, kind, format, attempt string
}

var errUploadSuperseded = errors.New("upload processing attempt was superseded")

const uploadSelect = `SELECT j.id,j.client_upload_id,j.status,j.filename,j.kind,j.created_at,j.error_code,j.category_id,j.welcome_revision,j.welcome_widget_index,
 media.id,g.id,g.name,media.width,media.height,media.created_at,media.mime,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END
 FROM upload_jobs j JOIN guests viewer ON viewer.id=j.guest_id CROSS JOIN welcome w
 LEFT JOIN guest_welcome_progress p ON p.guest_id=viewer.id
 LEFT JOIN photos media ON media.id=j.photo_id AND (viewer.role='admin' OR
 (` + welcomeAccessSQL + ` AND (media.category_id IS NULL OR EXISTS (SELECT 1 FROM media_categories c WHERE c.id=media.category_id AND c.is_public))))
 LEFT JOIN guests g ON g.id=media.guest_id`

func scanUpload(row interface{ Scan(...any) error }) (UploadJob, error) {
	var job UploadJob
	var id, authorID, width, height sql.NullInt64
	var authorName, createdAt, mime sql.NullString
	var avatarVersion int64
	err := row.Scan(&job.ID, &job.ClientUploadID, &job.Status, &job.Filename, &job.Kind, &job.CreatedAt, &job.ErrorCode, &job.CategoryID, &job.WelcomeRevision, &job.WelcomeWidgetIndex,
		&id, &authorID, &authorName, &width, &height, &createdAt, &mime, &avatarVersion)
	if id.Valid {
		job.Photo = &Photo{ID: id.Int64, Author: Author{ID: authorID.Int64, Name: authorName.String, AvatarURL: avatarURL(authorID.Int64, avatarVersion)}, Width: int(width.Int64), Height: int(height.Int64), CreatedAt: createdAt.String, MIMEType: mime.String}
		job.Photo.CategoryID = job.CategoryID
		job.Photo.urls()
	}
	return job, err
}

func (a *App) uploadByID(ctx context.Context, id, guestID int64) (UploadJob, error) {
	return scanUpload(a.db.QueryRowContext(ctx, uploadSelect+` WHERE j.id=$1 AND j.guest_id=$2`, id, guestID))
}

func (a *App) uploadByClientID(ctx context.Context, guestID int64, clientID string) (UploadJob, error) {
	return scanUpload(a.db.QueryRowContext(ctx, uploadSelect+` WHERE j.guest_id=$1 AND j.client_upload_id=$2`, guestID, clientID))
}

func (a *App) recentUploads(ctx context.Context, guestID int64) ([]UploadJob, error) {
	rows, err := a.db.QueryContext(ctx, uploadSelect+`
 WHERE j.guest_id=$1 AND (j.status IN ('queued','processing') OR j.id IN
 (SELECT id FROM upload_jobs WHERE guest_id=$1 AND status IN ('ready','failed') AND updated_at::timestamptz >= $2::timestamptz ORDER BY id DESC LIMIT 50)) ORDER BY j.id DESC LIMIT 150`, guestID, stamp(a.now().Add(-uploadHistoryTTL)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []UploadJob{}
	for rows.Next() {
		job, err := scanUpload(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, job)
	}
	return items, rows.Err()
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

func (a *App) enqueueUpload(ctx context.Context, guestID int64, clientID string, upload receivedUpload, destination uploadDestination) (UploadJob, error) {
	var job UploadJob
	key, err := newToken()
	if err != nil {
		return job, err
	}
	inputPath := filepath.Join(a.config.DataDir, "uploads", key+".input")
	retained := false
	defer func() {
		if !retained {
			os.Remove(inputPath)
		}
	}()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return job, err
	}
	defer tx.Rollback()
	// Serialize quota reservations across receivers, without holding a lock while reading files.
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		return job, err
	}
	if err = a.authorizeUpload(ctx, tx, guestID, &destination); err != nil {
		return job, err
	}
	job, err = scanUpload(tx.QueryRowContext(ctx, uploadSelect+` WHERE j.guest_id=$1 AND j.client_upload_id=$2`, guestID, clientID))
	if err == nil {
		return job, sameUploadDestination(job, destination)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return job, err
	}
	var total, owned int
	var queuedBytes int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COUNT(*) FILTER (WHERE guest_id=$1),COALESCE(SUM(byte_size),0) FROM upload_jobs WHERE status IN ('queued','processing')", guestID).Scan(&total, &owned, &queuedBytes); err != nil {
		return job, err
	}
	if total >= maxQueuedUploads || owned >= maxGuestUploads || queuedBytes+upload.size > maxQueuedBytes {
		return job, &mediaValidationError{409, "upload_queue_full"}
	}
	if err = os.Rename(upload.path, inputPath); err != nil {
		return job, err
	}
	job = UploadJob{ClientUploadID: clientID, Status: "queued", Filename: upload.filename, Kind: upload.kind, CreatedAt: stamp(a.now())}
	job.CategoryID, job.WelcomeRevision = destination.categoryID, destination.welcomeRevision
	job.WelcomeWidgetIndex = destination.welcomeWidgetIndex
	err = tx.QueryRowContext(ctx, `INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,category_id,welcome_revision,welcome_widget_index) VALUES($1,$2,'queued',$3,$4,$5,$6,$7,$8,$8,$9,$10,$11) RETURNING id`, guestID, clientID, upload.filename, upload.kind, upload.format, key, upload.size, job.CreatedAt, job.CategoryID, job.WelcomeRevision, job.WelcomeWidgetIndex).Scan(&job.ID)
	if err != nil {
		return job, err
	}
	// A lost commit response is ambiguous. Keep the spool file so a retry with the
	// same client ID can recover a committed job; startup removes unused files.
	retained = true
	return job, tx.Commit()
}

func (a *App) claimUpload(ctx context.Context) (pendingUpload, error) {
	ctx, cancel := context.WithTimeout(ctx, workerQueryTimeout)
	defer cancel()
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
	// A retry goes behind jobs that have waited longer, so unavailable video tools
	// cannot keep later images from reaching the gallery.
	err = tx.QueryRowContext(ctx, `UPDATE upload_jobs SET status='processing',updated_at=$1,attempt_id=$2 WHERE id=(SELECT id FROM upload_jobs WHERE status='queued' ORDER BY updated_at::timestamptz,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,guest_id,storage_key,kind,input_format,attempt_id`, stamp(a.now()), attempt).Scan(&job.id, &job.guestID, &job.key, &job.kind, &job.format, &job.attempt)
	if err != nil {
		return job, err
	}
	return job, tx.Commit()
}
