package media

import (
	"context"
	"database/sql"
	"errors"
	"time"

	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"birthday-party/backend/internal/timestamp"
)

// uploadSelect joins the published photo only when the job's owner may see it.
const uploadSelect = `SELECT j.id,j.client_upload_id,j.status,j.filename,j.kind,j.created_at,j.error_code,j.category_id,j.welcome_revision,j.welcome_widget_index,
 media.id,g.id,g.name,media.width,media.height,media.created_at,media.mime,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END
 FROM upload_jobs j JOIN guests viewer ON viewer.id=j.guest_id CROSS JOIN welcome w
 LEFT JOIN guest_welcome_progress p ON p.guest_id=viewer.id
 LEFT JOIN photos media ON media.id=j.photo_id AND (viewer.role='admin' OR
 (` + pgwelcome.AccessSQL + ` AND (media.category_id IS NULL OR EXISTS (SELECT 1 FROM media_categories c WHERE c.id=media.category_id AND c.is_public))))
 LEFT JOIN guests g ON g.id=media.guest_id`

func scanUpload(row interface{ Scan(...any) error }) (media.Upload, error) {
	var job media.Upload
	var created time.Time
	var id, authorID, width, height sql.NullInt64
	var authorName, mime sql.NullString
	var published sql.NullTime
	var avatarVersion int64
	err := row.Scan(&job.ID, &job.ClientUploadID, &job.Status, &job.Filename, &job.Kind, &created, &job.ErrorCode, &job.CategoryID, &job.WelcomeRevision, &job.WelcomeWidgetIndex,
		&id, &authorID, &authorName, &width, &height, &published, &mime, &avatarVersion)
	job.CreatedAt = timestamp.Format(created)
	if id.Valid {
		job.Photo = &media.Photo{
			ID:         id.Int64,
			CategoryID: job.CategoryID,
			Author:     identity.Author{ID: authorID.Int64, Name: authorName.String, AvatarURL: identity.AvatarURL(authorID.Int64, avatarVersion)},
			Width:      int(width.Int64),
			Height:     int(height.Int64),
			CreatedAt:  timestamp.Format(published.Time),
			MIMEType:   mime.String,
		}
		job.Photo.SetURLs()
	}
	return job, err
}

func (s *Store) Upload(ctx context.Context, id, guestID int64) (media.Upload, error) {
	job, err := scanUpload(s.db.QueryRowContext(ctx, uploadSelect+` WHERE j.id=$1 AND j.guest_id=$2`, id, guestID))
	if errors.Is(err, sql.ErrNoRows) {
		err = media.ErrNotFound
	}
	return job, err
}

func (s *Store) Recent(ctx context.Context, guestID int64, now time.Time) ([]media.Upload, error) {
	rows, err := s.db.QueryContext(ctx, uploadSelect+`
 WHERE j.guest_id=$1 AND (j.status IN ('queued','processing') OR j.id IN
 (SELECT id FROM upload_jobs WHERE guest_id=$1 AND status IN ('ready','failed') AND updated_at>=$2 ORDER BY id DESC LIMIT 50)) ORDER BY j.id DESC LIMIT 150`, guestID, now.Add(-media.HistoryTTL))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []media.Upload{}
	for rows.Next() {
		job, err := scanUpload(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, job)
	}
	return items, rows.Err()
}

func (s *Store) Accept(ctx context.Context, guestID int64, clientID, key string, upload media.Received, destination media.Destination, stage func() error) (media.Upload, bool, error) {
	var job media.Upload
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return job, false, err
	}
	defer tx.Rollback()
	// Serialize quota reservations across receivers, without holding a lock while reading files.
	if _, err = tx.ExecContext(ctx, quotaLock); err != nil {
		return job, false, err
	}
	if err = s.authorizeUpload(ctx, tx, guestID, &destination); err != nil {
		return job, false, err
	}
	job, err = scanUpload(tx.QueryRowContext(ctx, uploadSelect+` WHERE j.guest_id=$1 AND j.client_upload_id=$2`, guestID, clientID))
	if err == nil {
		return job, false, media.SameDestination(job, destination)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return job, false, err
	}
	var total, owned int
	var queuedBytes int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COUNT(*) FILTER (WHERE guest_id=$1),COALESCE(SUM(byte_size),0) FROM upload_jobs WHERE status IN ('queued','processing')", guestID).Scan(&total, &owned, &queuedBytes); err != nil {
		return job, false, err
	}
	if err := media.ValidateQueueCapacity(total, owned, queuedBytes, upload.Size); err != nil {
		return job, false, err
	}
	if err := stage(); err != nil {
		return job, false, err
	}
	now := s.now()
	job = media.Upload{
		ClientUploadID: clientID, Status: media.StatusQueued, Filename: upload.Filename, Kind: upload.Kind, CreatedAt: timestamp.Format(now),
		CategoryID: destination.CategoryID, WelcomeRevision: destination.WelcomeRevision, WelcomeWidgetIndex: destination.WelcomeWidgetIndex,
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,available_at,category_id,welcome_revision,welcome_widget_index)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$10,$11,$12) RETURNING id`,
		guestID, clientID, job.Status, upload.Filename, upload.Kind, upload.Format, key, upload.Size, now, job.CategoryID, job.WelcomeRevision, job.WelcomeWidgetIndex).Scan(&job.ID)
	if err != nil {
		return job, false, err
	}
	// Preserve input if a commit response is lost; recovery resolves ownership.
	if err := tx.Commit(); err != nil {
		return job, true, err
	}
	return job, true, nil
}

func (s *Store) Claim(ctx context.Context, attempt string) (media.Pending, error) {
	var job media.Pending
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return job, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, quotaLock); err != nil {
		return job, err
	}
	// A retry becomes available later than jobs already waiting, so a failing
	// upload cannot keep other guests' media from reaching the gallery.
	err = tx.QueryRowContext(ctx, `UPDATE upload_jobs SET status='processing',updated_at=$1,attempt_id=$2,attempts=attempts+1
 WHERE id=(SELECT id FROM upload_jobs WHERE status='queued' AND available_at<=$1 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING id,guest_id,storage_key,kind,input_format,attempt_id,attempts`, s.now(), attempt).Scan(&job.ID, &job.GuestID, &job.Key, &job.Kind, &job.Format, &job.Attempt, &job.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return job, media.ErrNoWork
	}
	if err != nil {
		return job, err
	}
	if err := tx.Commit(); err != nil {
		return job, err
	}
	return job, nil
}
