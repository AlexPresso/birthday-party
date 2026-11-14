package mediafiles

import "testing"

func TestSpaceReadsTheDataDisk(t *testing.T) {
	storage, err := New(t.TempDir(), nil).Space()
	if err != nil {
		t.Fatal(err)
	}
	if storage.TotalBytes <= 0 || storage.AvailableBytes < 0 || storage.AvailableBytes > storage.TotalBytes {
		t.Fatalf("implausible disk %+v", storage)
	}
}
