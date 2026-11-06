// Package mediafiles implements private local storage and bounded image/video processing.
package mediafiles

import (
	"errors"
	"os"
	"path/filepath"

	"birthday-party/backend/internal/media"
)

type Files struct{ root string }

func New(root string) *Files { return &Files{root: root} }

func (f *Files) StageInput(input media.Received, key string) error {
	return os.Rename(input.Path, filepath.Join(f.root, "uploads", key+".input"))
}
func (f *Files) RemoveInput(key string) {
	_ = os.Remove(filepath.Join(f.root, "uploads", key+".input"))
}
func (f *Files) RemoveReceived(input media.Received) { _ = os.Remove(input.Path) }
func (f *Files) RemoveAttempt(job media.Pending) {
	for _, suffix := range []string{".jpg", ".png", ".webp", ".mp4", ".mov", ".webm", ".mkv", ".thumb.jpg"} {
		_ = os.Remove(filepath.Join(f.root, "photos", job.Key+"-"+job.Attempt+suffix))
	}
}
func (f *Files) RemovePublished(file media.File) error {
	var result error
	for _, name := range []string{file.Filename, file.Thumbnail} {
		if name == "" {
			continue
		}
		if err := os.Remove(filepath.Join(f.root, "photos", name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			result = errors.Join(result, err)
		}
	}
	return result
}
func (f *Files) OpenPublished(name string) (media.ReadSeekCloser, error) {
	file, err := os.Open(filepath.Join(f.root, "photos", name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, &media.Error{Code: "photo_unavailable"}
	}
	return file, err
}

// Recover runs only while the process and queue maintenance locks are held.
func (f *Files) Recover(inventory media.Inventory) error {
	for _, directory := range []struct {
		name       string
		referenced map[string]bool
	}{{"uploads", inventory.Inputs}, {"photos", inventory.Photos}} {
		entries, err := os.ReadDir(filepath.Join(f.root, directory.name))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !entry.IsDir() && !directory.referenced[entry.Name()] {
				if err := os.Remove(filepath.Join(f.root, directory.name, entry.Name())); err != nil {
					return err
				}
			}
		}
	}
	entries, err := os.ReadDir(filepath.Join(f.root, "tmp"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(f.root, "tmp", entry.Name())); err != nil {
			return err
		}
	}
	return nil
}
