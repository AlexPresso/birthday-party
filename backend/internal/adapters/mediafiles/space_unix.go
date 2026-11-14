//go:build !windows

package mediafiles

import (
	"fmt"
	"syscall"

	"birthday-party/backend/internal/media"
)

func diskSpace(path string) (media.Storage, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return media.Storage{}, fmt.Errorf("read disk space: %w", err)
	}
	block := int64(stat.Bsize)
	return media.Storage{TotalBytes: int64(stat.Blocks) * block, AvailableBytes: int64(stat.Bavail) * block}, nil
}
