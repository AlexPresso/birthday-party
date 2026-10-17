package app

import (
	"context"
	"os"
	"path/filepath"
)

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
	ctx, cancel := context.WithTimeout(ctx, workerQueryTimeout)
	defer cancel()
	rows, err := a.db.QueryContext(ctx, "DELETE FROM upload_jobs WHERE status IN ('ready','failed') AND updated_at::timestamptz<$1::timestamptz RETURNING guest_id", stamp(a.now().Add(-uploadHistoryTTL)))
	if err != nil {
		return err
	}
	owners, err := readUploadOwners(rows)
	if err != nil {
		return err
	}
	for owner := range owners {
		a.realtime.notify(owner, realtimeUploads)
	}
	return nil
}
