package mediafiles

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"birthday-party/backend/internal/media"
)

const maxVideoSeconds = 300
const maxVideoPixels = 4096 * 2160
const maxVideoDiagnosticBytes = 64 << 10

// Stable FFERRTAG values from FFmpeg's libavutil/error.h.
const avErrorInvalidData = -1094995529
const avErrorEOF = -541478725

var errVideoMetadataLimit = errors.New("video metadata exceeds limit")

// The filename and claimed MIME type never select a decoder.
func detectVideoFormat(header []byte) string {
	if len(header) >= 8 {
		switch string(header[4:8]) {
		case "ftyp", "moov", "mdat", "wide", "free":
			return "mov"
		}
	}
	if bytes.HasPrefix(header, []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		return "matroska"
	}
	return ""
}

type videoProbe struct {
	Error *struct {
		Code int `json:"code"`
	} `json:"error"`
	Streams []struct {
		CodecType   string `json:"codec_type"`
		CodecName   string `json:"codec_name"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		Duration    string `json:"duration"`
		Channels    int    `json:"channels"`
		Disposition struct {
			AttachedPicture int `json:"attached_pic"`
		} `json:"disposition"`
		SideData []struct {
			Rotation float64 `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
	Format struct {
		Name     string `json:"format_name"`
		Duration string `json:"duration"`
		Tags     struct {
			MajorBrand string `json:"major_brand"`
		} `json:"tags"`
	} `json:"format"`
}

func videoInputArgs(format string) []string {
	args := []string{
		"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
		"-probesize", "5000000", "-analyzeduration", "5000000", "-max_streams", "8",
		"-threads", "2", "-max_pixels", strconv.Itoa(maxVideoPixels), "-f", format,
	}
	if format == "mov" {
		// MOV reference movies must not open another local file or remote URL.
		args = append(args, "-enable_drefs", "0", "-use_absolute_path", "0")
	}
	return args
}

type limitedProbeOutput struct {
	buffer   bytes.Buffer
	exceeded bool
}

func (b *limitedProbeOutput) Write(p []byte) (int, error) {
	if len(p) > maxVideoDiagnosticBytes-b.buffer.Len() {
		b.exceeded = true
		return 0, errVideoMetadataLimit
	}
	return b.buffer.Write(p)
}

// Retain causes for errors.Is/As without logging private paths or tool diagnostics.
type videoCommandError struct {
	operation string
	cause     error
}

func (e *videoCommandError) Error() string {
	switch {
	case errors.Is(e.cause, context.Canceled):
		return e.operation + " canceled"
	case errors.Is(e.cause, context.DeadlineExceeded):
		return e.operation + " timed out"
	case errors.Is(e.cause, exec.ErrNotFound):
		return e.operation + " unavailable"
	}
	var exit *exec.ExitError
	if errors.As(e.cause, &exit) {
		return fmt.Sprintf("%s failed (exit code %d)", e.operation, exit.ExitCode())
	}
	var path *os.PathError
	if errors.As(e.cause, &path) {
		return fmt.Sprintf("%s failed: %v", e.operation, path.Err)
	}
	return e.operation + " failed"
}

func (e *videoCommandError) Unwrap() error { return e.cause }

func probeVideo(ctx context.Context, path, format string) (videoProbe, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	args := []string{"-v", "error", "-max_alloc", "134217728"}
	args = append(args, videoInputArgs(format)...)
	args = append(args, "-show_error", "-show_entries", "error=code:format=format_name,duration:format_tags=major_brand:stream=codec_type,codec_name,width,height,duration,channels:stream_disposition=attached_pic:stream_side_data=rotation", "-of", "json", path)
	cmd := exec.CommandContext(ctx, "ffprobe", args...)
	var output limitedProbeOutput
	cmd.Stdout = &output
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return videoProbe{}, &videoCommandError{"video probe", errors.Join(runErr, ctx.Err())}
	}
	if output.exceeded {
		return videoProbe{}, errors.Join(&media.Error{Code: "unreadable_video"}, errVideoMetadataLimit, &videoCommandError{"video probe", runErr})
	}
	var probe videoProbe
	decodeErr := json.Unmarshal(output.buffer.Bytes(), &probe)
	if runErr != nil {
		cause := &videoCommandError{"video probe", runErr}
		// AVERROR_INVALIDDATA and AVERROR_EOF identify malformed input. Other
		// failures (including filesystem and memory errors) retain the original.
		if decodeErr == nil && probe.Error != nil && (probe.Error.Code == avErrorInvalidData || probe.Error.Code == avErrorEOF) {
			return videoProbe{}, errors.Join(&media.Error{Code: "unreadable_video"}, cause)
		}
		return videoProbe{}, cause
	}
	if decodeErr != nil {
		return videoProbe{}, &videoCommandError{"decode video probe response", decodeErr}
	}
	return probe, nil
}

type videoDiagnostics struct {
	buffer    bytes.Buffer
	truncated bool
}

func (d *videoDiagnostics) Write(p []byte) (int, error) {
	n := min(len(p), maxVideoDiagnosticBytes-d.buffer.Len())
	_, _ = d.buffer.Write(p[:n])
	d.truncated = d.truncated || n < len(p)
	return len(p), nil
}

func (d *videoDiagnostics) invalidInput() bool {
	if d.truncated {
		return false
	}
	output := strings.ToLower(d.buffer.String())
	// FFmpeg has no structured error output. Be conservative: recognized system
	// failures and unknown diagnostics retry instead of discarding private input.
	for _, message := range []string{
		"no space left on device", "disk quota exceeded", "permission denied",
		"read-only file system", "input/output error", "cannot allocate memory",
		"resource temporarily unavailable", "too many open files",
		"error opening output", "error writing", "error submitting a packet to the muxer",
	} {
		if strings.Contains(output, message) {
			return false
		}
	}
	for _, message := range []string{
		"invalid data found when processing input", "error while decoding stream",
		"error submitting packet to decoder", "error sending packet to decoder",
		"corrupt decoded frame", "invalid nal unit", "moov atom not found",
		"ebml header parsing failed",
	} {
		if strings.Contains(output, message) {
			return true
		}
	}
	return false
}

func runFFmpeg(ctx context.Context, args []string) error {
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	var diagnostics videoDiagnostics
	cmd.Stderr = &diagnostics
	err := cmd.Run()
	if err == nil {
		return nil
	}
	cause := &videoCommandError{"video processing", errors.Join(err, ctx.Err())}
	var exit *exec.ExitError
	if ctx.Err() == nil && errors.As(err, &exit) && exit.ExitCode() >= 0 && diagnostics.invalidInput() {
		return errors.Join(&media.Error{Code: "video_processing_failed"}, cause)
	}
	return cause
}

func (p videoProbe) validate(maxSeconds float64) (int, int, error) {
	invalid := &media.Error{Code: "unreadable_video"}
	if p.Format.Name != "mov,mp4,m4a,3gp,3g2,mj2" && p.Format.Name != "matroska,webm" {
		return 0, 0, invalid
	}
	duration, err := strconv.ParseFloat(p.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || len(p.Streams) > 8 {
		return 0, 0, invalid
	}
	if duration > maxSeconds {
		return 0, 0, &media.Error{Code: "video_too_long"}
	}
	width, height := 0, 0
	for _, stream := range p.Streams {
		if value, err := strconv.ParseFloat(stream.Duration, 64); err == nil && value > maxSeconds {
			return 0, 0, &media.Error{Code: "video_too_long"}
		}
		if stream.CodecType == "audio" && stream.Channels > 8 {
			return 0, 0, invalid
		}
		if stream.CodecType != "video" {
			continue
		}
		if width != 0 || stream.Disposition.AttachedPicture != 0 {
			return 0, 0, invalid
		}
		switch stream.CodecName {
		case "h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "prores":
		default:
			return 0, 0, invalid
		}
		width, height = stream.Width, stream.Height
		if width < 2 || height < 2 {
			return 0, 0, invalid
		}
		if max(width, height) > 4096 || min(width, height) > 2160 || int64(width)*int64(height) > maxVideoPixels {
			return 0, 0, &media.Error{Code: "video_dimensions_too_large"}
		}
		// Keep the gallery aspect ratio aligned with rotated phone playback and previews.
		for _, data := range stream.SideData {
			if math.Mod(math.Abs(data.Rotation), 180) == 90 {
				width, height = height, width
				break
			}
		}
	}
	if width == 0 {
		return 0, 0, invalid
	}
	return width, height, nil
}

func prepareVideo(ctx context.Context, inputPath, workDir, format string) (preparedMedia, error) {
	probe, err := probeVideo(ctx, inputPath, format)
	if err != nil {
		return preparedMedia{}, err
	}
	width, height, err := probe.validate(maxVideoSeconds)
	if err != nil {
		return preparedMedia{}, err
	}
	prepared := preparedMedia{
		path: inputPath, thumbnailPath: filepath.Join(workDir, "thumb.jpg"),
		width: width, height: height,
	}
	prepared.extension, prepared.mimeType, err = originalVideoType(inputPath, probe)
	if err != nil {
		return preparedMedia{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	// Only the preview is resized. Playback and downloads use the untouched input.
	args := []string{"-nostdin", "-v", "error", "-xerror", "-max_alloc", "134217728", "-filter_threads", "2"}
	args = append(args, videoInputArgs(format)...)
	args = append(args,
		"-i", inputPath, "-map", "0:v:0", "-frames:v", "1", "-map_metadata", "-1", "-map_chapters", "-1",
		"-vf", "scale=720:720:force_original_aspect_ratio=decrease", "-threads", "2", "-q:v", "3", "-update", "1", prepared.thumbnailPath,
	)
	if err := runFFmpeg(ctx, args); err != nil {
		return preparedMedia{}, err
	}
	if err := os.Chmod(prepared.thumbnailPath, 0600); err != nil {
		return preparedMedia{}, err
	}
	return prepared, nil
}
