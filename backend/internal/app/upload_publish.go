package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
)

func (a *App) prepareAndStoreUpload(ctx context.Context, job pendingUpload) error {
	inputPath := filepath.Join(a.config.DataDir, "uploads", job.key+".input")
	if _, err := os.Stat(inputPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &mediaValidationError{404, "photo_unavailable"}
		}
		return err
	}
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
