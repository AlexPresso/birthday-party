package mediafiles

import (
	"birthday-party/backend/internal/media"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestProbeOutputLimitIncludesReaderFromCopies(t *testing.T) {
	for _, size := range []int{maxVideoDiagnosticBytes, maxVideoDiagnosticBytes + 1, maxVideoDiagnosticBytes * 2} {
		var output limitedProbeOutput
		// Mask strings.Reader.WriteTo to exercise the io.Copy path used by os/exec.
		source := struct{ io.Reader }{strings.NewReader(strings.Repeat("x", size))}
		_, err := io.Copy(&output, source)
		if size <= maxVideoDiagnosticBytes {
			if err != nil || output.buffer.Len() != size {
				t.Fatalf("copy %d bytes: stored=%d error=%v", size, output.buffer.Len(), err)
			}
		} else if !errors.Is(err, errVideoMetadataLimit) || !output.exceeded {
			t.Fatalf("copy %d bytes: expected metadata limit, got %v", size, err)
		}
		if output.buffer.Len() > maxVideoDiagnosticBytes {
			t.Fatalf("copy stored %d bytes beyond the metadata limit", output.buffer.Len())
		}
	}
}

func TestVideoDiagnosticsStayBoundedAndConservative(t *testing.T) {
	for _, test := range []struct {
		name, output string
		invalid      bool
	}{
		{"corrupt input", "Invalid data found when processing input", true},
		{"decoder failure", "Error submitting packet to decoder", true},
		{"storage failure after decode error", "Invalid NAL unit\nNo space left on device", false},
		{"output permission", "Error opening output file: Permission denied", false},
		{"unknown failure", "An unrecognized failure", false},
		{"truncated diagnostics", "Invalid data found when processing input" + strings.Repeat("x", maxVideoDiagnosticBytes), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var diagnostics videoDiagnostics
			n, err := io.Copy(&diagnostics, strings.NewReader(test.output))
			if err != nil || n != int64(len(test.output)) {
				t.Fatalf("drain diagnostics: copied=%d error=%v", n, err)
			}
			if diagnostics.buffer.Len() > maxVideoDiagnosticBytes {
				t.Fatalf("stored %d diagnostic bytes", diagnostics.buffer.Len())
			}
			if got := diagnostics.invalidInput(); got != test.invalid {
				t.Fatalf("invalid input=%v, want %v", got, test.invalid)
			}
		})
	}
}

func TestMissingVideoToolsRemainRetryable(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	_, probeErr := probeVideo(context.Background(), "private-input.mp4", "mov")
	conversionErr := runFFmpeg(context.Background(), nil)
	for _, err := range []error{probeErr, conversionErr} {
		var validation *media.Error
		if !errors.Is(err, exec.ErrNotFound) || errors.As(err, &validation) {
			t.Fatalf("missing tool should remain retryable and preserve its cause: %v", err)
		}
	}
}

func TestVideoCommandCancellationRemainsRetryable(t *testing.T) {
	for _, test := range []struct {
		name string
		ctx  func() (context.Context, context.CancelFunc)
		want error
	}{
		{"canceled", func() (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return ctx, cancel
		}, context.Canceled},
		{"deadline", func() (context.Context, context.CancelFunc) {
			return context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		}, context.DeadlineExceeded},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := test.ctx()
			defer cancel()
			_, probeErr := probeVideo(ctx, "private-input.mp4", "mov")
			conversionErr := runFFmpeg(ctx, nil)
			for _, err := range []error{probeErr, conversionErr} {
				var validation *media.Error
				if !errors.Is(err, test.want) || errors.As(err, &validation) {
					t.Fatalf("cancellation should preserve its cause without rejecting input: %v", err)
				}
			}
		})
	}
}

func TestVideoCommandErrorHidesPrivatePathsAndPreservesCause(t *testing.T) {
	cause := &os.PathError{Op: "open", Path: "/private/guest/video.mp4", Err: os.ErrPermission}
	err := &videoCommandError{"video conversion", cause}
	if !errors.Is(err, os.ErrPermission) {
		t.Fatal("command error lost its underlying permission error")
	}
	if strings.Contains(err.Error(), cause.Path) {
		t.Fatal("command error exposes a private path")
	}
}

func TestVideoToolsRejectCorruptInputAndRetryOutputFailures(t *testing.T) {
	data := videoFixture(t, "mp4")
	inputPath := filepath.Join(t.TempDir(), "input.mp4")
	if err := os.WriteFile(inputPath, data[:32], 0600); err != nil {
		t.Fatal(err)
	}
	_, probeErr := probeVideo(context.Background(), inputPath, "mov")
	conversionErr := runFFmpeg(context.Background(), []string{"-nostdin", "-v", "error", "-i", inputPath, "-f", "null", "-"})
	for _, err := range []error{probeErr, conversionErr} {
		var validation *media.Error
		var exit *exec.ExitError
		if !errors.As(err, &validation) || !errors.As(err, &exit) {
			t.Fatalf("corrupt clip should be terminal and preserve the command failure: %v", err)
		}
		if strings.Contains(err.Error(), inputPath) {
			t.Fatal("command error exposes the private input path")
		}
	}
	if err := os.WriteFile(inputPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	_, err := prepareVideo(context.Background(), inputPath, filepath.Join(t.TempDir(), "absent-output-directory"), "mov", defaultMaxVideoBytes)
	var validation *media.Error
	var exit *exec.ExitError
	if err == nil || errors.As(err, &validation) || !errors.As(err, &exit) {
		t.Fatalf("output storage failure should be retryable and preserve the command failure: %v", err)
	}
	if got, err := os.ReadFile(inputPath); err != nil || len(got) != len(data) {
		t.Fatalf("failed processing changed the original input: bytes=%d error=%v", len(got), err)
	}
	_, err = probeVideo(context.Background(), filepath.Join(t.TempDir(), "missing.mp4"), "mov")
	if err == nil || errors.As(err, &validation) || !errors.As(err, &exit) {
		t.Fatalf("probe filesystem failure should be retryable: %v", err)
	}
}

func TestFFmpegFullOutputDeviceRemainsRetryable(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("full output device test requires Linux")
	}
	if _, err := os.Stat("/dev/full"); err != nil {
		t.Skip("full output device is unavailable")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("full output device test requires ffmpeg")
	}
	err := runFFmpeg(context.Background(), []string{
		"-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=16x16:r=1",
		"-frames:v", "1", "-threads", "1", "-f", "rawvideo", "/dev/full",
	})
	var validation *media.Error
	var exit *exec.ExitError
	if err == nil || errors.As(err, &validation) || !errors.As(err, &exit) {
		t.Fatalf("full output device should be retryable: %v", err)
	}
}

func videoFixture(t *testing.T, format string) []byte {
	t.Helper()
	return videoFixtureDuration(t, format, "0.6")
}
func videoFixtureDuration(t *testing.T, format, duration string) []byte {
	t.Helper()
	for _, binary := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skip("video integration tests require ffmpeg and ffprobe")
		}
	}
	path := filepath.Join(t.TempDir(), "fixture."+format)
	videoCodec, audioCodec := "libx264", "aac"
	if format == "webm" {
		videoCodec, audioCodec = "libvpx-vp9", "libopus"
	}
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=purple:s=160x90:r=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", duration, "-c:v", videoCodec, "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", audioCodec, path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create video fixture: %v: %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestVideoMetadataLimits(t *testing.T) {
	valid := `{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"300"},"streams":[{"codec_type":"video","codec_name":"hevc","width":2160,"height":3840}]}`
	for _, test := range []struct {
		name, source, code string
	}{
		{"portrait 4K boundary", valid, ""},
		{"too long", strings.Replace(valid, `"300"`, `"300.1"`, 1), "video_too_long"},
		{"oversized frame", strings.Replace(valid, `3840`, `9000`, 1), "video_dimensions_too_large"},
		{"invalid duration", strings.Replace(valid, `"300"`, `"NaN"`, 1), "unreadable_video"},
		{"no video", strings.Replace(valid, `"video"`, `"audio"`, 1), "unreadable_video"},
		{"playlist format", strings.Replace(valid, `mov,mp4,m4a,3gp,3g2,mj2`, `hls`, 1), "unreadable_video"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var probe videoProbe
			if err := json.Unmarshal([]byte(test.source), &probe); err != nil {
				t.Fatal(err)
			}
			_, _, err := probe.validate(maxVideoSeconds)
			if test.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var validation *media.Error
			if !errors.As(err, &validation) || validation.Code != test.code {
				t.Fatalf("validation=%v want=%s", err, test.code)
			}
		})
	}
}
