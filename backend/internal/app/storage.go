package app

import (
	"context"
	"errors"
	"log"
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/media"
)

// checkStorage refuses an upload the disk cannot hold, counting what other
// receptions may still write, and tells the host when it refuses.
func (a *App) checkStorage(ctx context.Context, limits uploadLimits) error {
	storage, err := a.diskSpace()
	if err != nil {
		return err
	}
	err = media.CheckStorage(storage, storage.KeepFree(limits.ImageBytes, limits.VideoBytes), a.receivers.inFlight())
	var refused *media.Error
	if errors.As(err, &refused) {
		alert, cancel := context.WithTimeout(context.WithoutCancel(ctx), workerQueryTimeout)
		defer cancel()
		queued, alertErr := a.notifications.StorageFull(alert)
		a.storageAlerted(queued, alertErr)
	}
	return err
}

// watchStorage warns the host when the disk enters its warning range. A
// failure is logged: it must not fail the upload or the worker that asked.
func (a *App) watchStorage(ctx context.Context) {
	storage, err := a.diskSpace()
	if err != nil {
		log.Printf("read media disk space: %v", err)
		return
	}
	alert, cancel := context.WithTimeout(context.WithoutCancel(ctx), workerQueryTimeout)
	defer cancel()
	queued, err := a.notifications.StorageLevel(alert, storage.Warning(), storage.WarningCleared())
	a.storageAlerted(queued, err)
}

func (a *App) storageAlerted(queued bool, err error) {
	if err != nil {
		log.Printf("queue storage alert: %v", err)
	}
	if queued {
		a.notificationWake.notify()
	}
}

// adminStorage reports the media disk for the settings' storage bar.
func (a *App) adminStorage(w http.ResponseWriter, _ *http.Request, _ access.Viewer) {
	storage, err := a.diskSpace()
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, map[string]any{
		"totalBytes":     storage.TotalBytes,
		"availableBytes": storage.AvailableBytes,
		"warning":        storage.Warning(),
	})
}
