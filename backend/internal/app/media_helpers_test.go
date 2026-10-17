package app

import (
	"birthday-party/backend/internal/adapters/mediafiles"
	pgmedia "birthday-party/backend/internal/adapters/postgres/media"
	"birthday-party/backend/internal/media"
	"context"
	"database/sql"
	"errors"
	"log"
	"time"
)

// Integration fixtures keep their compact names while exercising the service ports.
type Photo = media.Photo
type MediaCategory = media.Category
type UploadJob = media.Upload

const maxQueuedBytes = media.MaxQueuedBytes
const maxStoredPhotoBytes = media.MaxStoredBytes

type pendingUpload struct {
	id, guestID                int64
	key, kind, format, attempt string
}

func (a *App) claimUpload(ctx context.Context) (pendingUpload, error) {
	job, err := a.media.Claim(ctx)
	if errors.Is(err, media.ErrNoWork) {
		err = sql.ErrNoRows
	}
	return pendingUpload{job.ID, job.GuestID, job.Key, job.Kind, job.Format, job.Attempt}, err
}
func (a *App) processUpload(ctx context.Context, job pendingUpload) {
	if err := a.media.Process(ctx, media.Pending{ID: job.id, GuestID: job.guestID, Key: job.key, Kind: job.kind, Format: job.format, Attempt: job.attempt}); err != nil {
		a.reportWorkerError(err)
	}
}
func (a *App) uploadByID(ctx context.Context, id, guestID int64) (media.Upload, error) {
	return a.media.Upload(ctx, id, guestID)
}
func (a *App) cleanUploadHistory(ctx context.Context) error { return a.media.CleanHistory(ctx) }
func newUploadID() (string, error)                          { return media.NewUploadID() }
func sameOptionalID(a, b *int64) bool                       { return media.SameOptionalID(a, b) }
func releaseWorkerConnection(conn *sql.Conn) error          { return pgmedia.ReleaseWorkerConnection(conn) }

func refreshTestMediaFiles(a *App) {
	a.mediaFiles = mediafiles.New(a.config.DataDir, a.config.MaxImageBytes, a.config.MaxVideoBytes)
	a.media = media.New(a.mediaStore, a.mediaFiles, func() time.Time { return a.now() }, func(id int64) { a.realtime.notify(id, realtimeUploads) }, log.Printf)
}
