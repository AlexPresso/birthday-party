package app

import (
	"context"
	"log"
)

func (a *App) notifyCategoryUploads(ctx context.Context, categoryID int64) {
	// The category update has committed even if its HTTP client disconnected.
	query, cancel := context.WithTimeout(context.WithoutCancel(ctx), workerQueryTimeout)
	defer cancel()
	owners, err := a.mediaStore.CategoryOwners(query, categoryID)
	if err != nil {
		log.Printf("read upload owners after category update: %v", err)
		return
	}
	for _, owner := range owners {
		a.realtime.notify(owner, realtimeUploads)
	}
}
