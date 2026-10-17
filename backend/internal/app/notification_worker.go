package app

import "context"

// The application starts this loop only while it owns the media-worker lease.
func (a *App) notificationWorker(ctx context.Context) {
	if err := a.notifications.Run(ctx); err != nil && ctx.Err() == nil {
		a.reportWorkerError(err)
	}
}
