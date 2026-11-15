//go:build windows

package mediafiles

import (
	"fmt"
	"syscall"
	"unsafe"

	"birthday-party/backend/internal/media"
)

var getDiskFreeSpace = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")

// diskSpace serves local development on Windows; containers use Statfs.
func diskSpace(path string) (media.Storage, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return media.Storage{}, err
	}
	var available, total, free uint64
	result, _, callErr := getDiskFreeSpace.Call(uintptr(unsafe.Pointer(name)),
		uintptr(unsafe.Pointer(&available)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&free)))
	if result == 0 {
		return media.Storage{}, fmt.Errorf("read disk space: %w", callErr)
	}
	return media.Storage{TotalBytes: int64(total), AvailableBytes: int64(available)}, nil
}
