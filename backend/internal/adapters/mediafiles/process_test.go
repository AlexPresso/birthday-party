package mediafiles

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"birthday-party/backend/internal/media"
)

func TestPreparePreservesOriginalVideos(t *testing.T) {
	for _, test := range []struct {
		format, mime string
	}{
		{"mp4", "video/mp4"},
		{"mov", "video/quicktime"},
		{"webm", "video/webm"},
		{"mkv", "video/x-matroska"},
	} {
		t.Run(test.format, func(t *testing.T) {
			data := videoFixture(t, test.format)
			files, job := stagedMedia(t, data, "video", detectVideoFormat(data))
			output, err := files.Prepare(context.Background(), job)
			if err != nil {
				t.Fatal(err)
			}
			if output.Filename != "upload-attempt."+test.format || output.MIME != test.mime {
				t.Fatalf("stored video type = %q %q", output.Filename, output.MIME)
			}
			if output.Width != 160 || output.Height != 90 {
				t.Fatalf("source dimensions changed: %dx%d", output.Width, output.Height)
			}
			assertFileBytes(t, filepath.Join(files.root, "photos", output.Filename), data)
			assertFileBytes(t, filepath.Join(files.root, "uploads", job.Key+".input"), data)
			thumbnail, err := os.ReadFile(filepath.Join(files.root, "photos", output.Thumbnail))
			if err != nil {
				t.Fatal(err)
			}
			config, format, err := image.DecodeConfig(bytes.NewReader(thumbnail))
			if err != nil || format != "jpeg" || config.Width > 720 || config.Height > 720 {
				t.Fatalf("invalid thumbnail: format=%s dimensions=%dx%d error=%v", format, config.Width, config.Height, err)
			}
			if output.Bytes != int64(len(data)+len(thumbnail)) {
				t.Fatalf("stored quota bytes = %d, want %d", output.Bytes, len(data)+len(thumbnail))
			}
			files.RemoveInput(job.Key)
			assertFileBytes(t, filepath.Join(files.root, "photos", output.Filename), data)
		})
	}
}

func TestPreparePreservesOriginalImageWithoutDuplicate(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 12, 8))); err != nil {
		t.Fatal(err)
	}
	files, job := stagedMedia(t, source.Bytes(), "image", "png")
	output, err := files.Prepare(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	assertFileBytes(t, filepath.Join(files.root, "photos", output.Filename), source.Bytes())
	entries, err := os.ReadDir(filepath.Join(files.root, "photos"))
	if err != nil || len(entries) != 2 {
		t.Fatalf("image should retain only its original and thumbnail: files=%d error=%v", len(entries), err)
	}
}

func TestPreparePreservesRotatedVideoAndDisplayDimensions(t *testing.T) {
	data := videoFixture(t, "mp4")
	input := filepath.Join(t.TempDir(), "input.mp4")
	rotated := filepath.Join(t.TempDir(), "rotated.mp4")
	if err := os.WriteFile(input, data, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("ffmpeg", "-v", "error", "-display_rotation", "90", "-i", input, "-c", "copy", rotated)
	commandOutput, err := cmd.CombinedOutput()
	if err != nil && bytes.Contains(commandOutput, []byte("Unrecognized option 'display_rotation'")) {
		// Older FFmpeg releases set display matrices through the rotate metadata tag.
		cmd = exec.Command("ffmpeg", "-v", "error", "-i", input, "-c", "copy", "-metadata:s:v:0", "rotate=90", rotated)
		commandOutput, err = cmd.CombinedOutput()
	}
	if err != nil {
		t.Fatalf("create rotated video fixture: %v: %s", err, commandOutput)
	}
	data, err = os.ReadFile(rotated)
	if err != nil {
		t.Fatal(err)
	}
	files, job := stagedMedia(t, data, "video", "mov")
	output, err := files.Prepare(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if output.Width != 90 || output.Height != 160 {
		t.Fatalf("display dimensions ignore rotation: %dx%d", output.Width, output.Height)
	}
	assertFileBytes(t, filepath.Join(files.root, "photos", output.Filename), data)
	thumbnail, err := os.ReadFile(filepath.Join(files.root, "photos", output.Thumbnail))
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(thumbnail))
	if err != nil || config.Width >= config.Height {
		t.Fatalf("preview should match portrait playback: %dx%d error=%v", config.Width, config.Height, err)
	}
}

func TestPrepareCopyFailureRetainsInputAndRemovesAttempt(t *testing.T) {
	data := videoFixture(t, "webm")
	files, job := stagedMedia(t, data, "video", "matroska")
	blockedThumbnail := filepath.Join(files.root, "photos", "upload-attempt.thumb.jpg")
	if err := os.Mkdir(blockedThumbnail, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blockedThumbnail, "blocker"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	_, err := files.Prepare(context.Background(), job)
	var validation *media.Error
	if err == nil || errors.As(err, &validation) {
		t.Fatalf("copy failure should retain input for retry: %v", err)
	}
	assertFileBytes(t, filepath.Join(files.root, "uploads", job.Key+".input"), data)
	if _, err := os.Stat(filepath.Join(files.root, "photos", "upload-attempt.webm")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed attempt left a published video: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(files.root, "tmp"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed attempt left processing files: files=%d error=%v", len(entries), err)
	}
}

func TestRemoveAttemptIncludesEveryVideoContainer(t *testing.T) {
	files, job := stagedMedia(t, []byte("source"), "video", "mov")
	for _, extension := range []string{"mp4", "mov", "webm", "mkv", "thumb.jpg"} {
		path := filepath.Join(files.root, "photos", "upload-attempt."+extension)
		if err := os.WriteFile(path, nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	other := filepath.Join(files.root, "photos", "upload-new-attempt.webm")
	if err := os.WriteFile(other, []byte("other attempt"), 0600); err != nil {
		t.Fatal(err)
	}
	files.RemoveAttempt(job)
	entries, err := os.ReadDir(filepath.Join(files.root, "photos"))
	if err != nil || len(entries) != 1 || entries[0].Name() != filepath.Base(other) {
		t.Fatalf("attempt cleanup touched another attempt or left output: files=%v error=%v", entries, err)
	}
	assertFileBytes(t, filepath.Join(files.root, "uploads", job.Key+".input"), []byte("source"))
}

func TestRemovePublishedSkipsEmptyNames(t *testing.T) {
	files, _ := stagedMedia(t, nil, "image", "png")
	if err := files.RemovePublished(media.File{}); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(files.root, "photos")); err != nil || !info.IsDir() {
		t.Fatalf("empty filenames must preserve the storage directory: %v", err)
	}
}

func stagedMedia(t *testing.T, data []byte, kind, format string) (*Files, media.Pending) {
	t.Helper()
	root := t.TempDir()
	for _, directory := range []string{"uploads", "photos", "tmp"} {
		if err := os.Mkdir(filepath.Join(root, directory), 0700); err != nil {
			t.Fatal(err)
		}
	}
	job := media.Pending{Key: "upload", Attempt: "attempt", Kind: kind, Format: format}
	if err := os.WriteFile(filepath.Join(root, "uploads", job.Key+".input"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return New(root), job
}

func assertFileBytes(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("stored bytes changed: size=%d want=%d error=%v", len(got), len(want), err)
	}
}
