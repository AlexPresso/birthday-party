package voicenote

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"birthday-party/backend/internal/guestbook"
)

// record makes a recording the way a browser would, with FFmpeg's test source.
func record(t *testing.T, source, codec, format string) []byte {
	t.Helper()
	path := filepath.Join(t.TempDir(), "input")
	output, err := exec.Command("ffmpeg", "-hide_banner", "-v", "error", "-f", "lavfi", "-i", source,
		"-c:a", codec, "-f", format, path).CombinedOutput()
	if err != nil {
		t.Fatalf("create recording: %v %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestEncoderNormalizesBrowserRecordings(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	encoder := New(t.TempDir())
	tone := "sine=frequency=440:duration=3"
	for _, test := range []struct{ name, codec, format string }{
		{"WebM Opus", "libopus", "webm"},
		{"Ogg Opus", "libopus", "ogg"},
		{"MP4 AAC", "aac", "mp4"},
	} {
		t.Run(test.name, func(t *testing.T) {
			voice, err := encoder.Encode(t.Context(), bytes.NewReader(record(t, tone, test.codec, test.format)))
			if err != nil {
				t.Fatal(err)
			}
			if voice.Duration < 2900*time.Millisecond || voice.Duration > 3100*time.Millisecond {
				t.Fatalf("duration = %v", voice.Duration)
			}
			if len(voice.Peaks) != guestbook.VoicePeaks || bytes.Count(voice.Peaks, []byte{0}) > 2 {
				t.Fatalf("peaks = %v", voice.Peaks)
			}
			if len(voice.Audio) < 12 || string(voice.Audio[4:8]) != "ftyp" {
				t.Fatal("the recording is not an MP4 file")
			}
		})
	}
	entries, err := os.ReadDir(encoder.dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary files remain: %v %v", entries, err)
	}
}

func TestEncoderRejectsUnreadableAndOverlongAudio(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	encoder := New(t.TempDir())
	for name, input := range map[string][]byte{
		"text":           []byte("not a recording"),
		"broken Ogg":     append([]byte("OggS"), bytes.Repeat([]byte{7}, 400)...),
		"over five mins": record(t, "anullsrc=r=8000:cl=mono:d=305", "libopus", "ogg"),
	} {
		if _, err := encoder.Encode(t.Context(), bytes.NewReader(input)); !errors.Is(err, guestbook.ErrInvalidVoice) {
			t.Fatalf("%s: error = %v", name, err)
		}
	}
	if _, err := encoder.Encode(t.Context(), bytes.NewReader(make([]byte, MaxInputBytes+1))); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversized error = %v", err)
	}
}
