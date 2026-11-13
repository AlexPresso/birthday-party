package media

import (
	"context"

	"birthday-party/backend/internal/media"
)

func (s *Store) Publish(ctx context.Context, job media.Pending, output media.Output) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, quotaLock); err != nil {
		return false, err
	}
	var status media.Status
	var attempt string
	var categoryID *int64
	if err = tx.QueryRowContext(ctx, "SELECT status,COALESCE(attempt_id,''),category_id FROM upload_jobs WHERE id=$1 FOR UPDATE", job.ID).Scan(&status, &attempt, &categoryID); err != nil {
		return false, err
	}
	if status != media.StatusProcessing || attempt != job.Attempt {
		return false, media.ErrSuperseded
	}
	var active bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1 FOR UPDATE", job.GuestID).Scan(&active); err != nil {
		return false, err
	}
	if !active {
		return false, &media.Error{Code: "access_revoked"}
	}
	var count int
	var stored int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(byte_size),0) FROM photos").Scan(&count, &stored); err != nil {
		return false, err
	}
	if err := media.ValidateAlbumCapacity(count, stored, output.Bytes); err != nil {
		return false, err
	}
	now := s.now()
	var photoID int64
	err = tx.QueryRowContext(ctx, `INSERT INTO photos(guest_id,filename,thumbnail,mime,width,height,byte_size,created_at,category_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		job.GuestID, output.Filename, output.Thumbnail, output.MIME, output.Width, output.Height, output.Bytes, now, categoryID).Scan(&photoID)
	if err != nil {
		return false, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE upload_jobs SET status=$1,photo_id=$2,updated_at=$3 WHERE id=$4", media.StatusReady, photoID, now, job.ID); err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return true, err
	}
	return true, nil
}
