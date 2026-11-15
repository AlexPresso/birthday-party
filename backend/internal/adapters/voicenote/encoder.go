// Package voicenote re-encodes guestbook voice notes with FFmpeg.
//
// Browsers record different containers (WebM or Ogg Opus, MP4 AAC) that not
// every browser plays. The encoder keeps none of the input: it writes one mono
// AAC file in MP4, which all of them play, measures its length from the decoded
// audio rather than from the container, and derives the waveform from it.
package voicenote

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	"birthday-party/backend/internal/guestbook"
)

const (
	// MaxInputBytes bounds a received recording: five minutes in any format a
	// browser records, with room to spare.
	MaxInputBytes  = 16 << 20
	maxOutputBytes = 4 << 20
	// The waveform is read from 1,000 samples per second of 16-bit audio.
	waveformRate  = 1000
	encodeTimeout = time.Minute
)

// ErrTooLarge reports a recording over MaxInputBytes.
var ErrTooLarge = errors.New("voice note too large")

// Encoder runs at most two encodings at a time, in private temporary files.
type Encoder struct {
	dir   string
	slots chan struct{}
}

// New writes its temporary files in dir, which startup recovery empties.
func New(dir string) *Encoder {
	return &Encoder{dir: dir, slots: make(chan struct{}, 2)}
}

// Encode reads one recording from input. Unreadable or overlong audio returns
// guestbook.ErrInvalidVoice; a missing FFmpeg or a system failure another error.
func (e *Encoder) Encode(ctx context.Context, input io.Reader) (guestbook.Voice, error) {
	source, err := os.CreateTemp(e.dir, "voice-*.input")
	if err != nil {
		return guestbook.Voice{}, err
	}
	defer os.Remove(source.Name())
	size, err := io.Copy(source, io.LimitReader(input, MaxInputBytes+1))
	if closeErr := source.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return guestbook.Voice{}, err
	}
	if size > MaxInputBytes {
		return guestbook.Voice{}, ErrTooLarge
	}
	format, err := detectFormat(source.Name())
	if err != nil {
		return guestbook.Voice{}, err
	}

	select {
	case e.slots <- struct{}{}:
		defer func() { <-e.slots }()
	case <-ctx.Done():
		return guestbook.Voice{}, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, encodeTimeout)
	defer cancel()
	output := source.Name() + ".m4a"
	defer os.Remove(output)
	waveform := &boundedBuffer{limit: int(guestbook.MaxVoiceDuration.Seconds()+1) * waveformRate * 2}
	cmd := exec.CommandContext(ctx, "ffmpeg", arguments(format, source.Name(), output)...)
	cmd.Stdout = waveform
	err = cmd.Run()
	if waveform.exceeded {
		return guestbook.Voice{}, guestbook.ErrInvalidVoice
	}
	if err != nil {
		// FFmpeg exits with an error for input it cannot read; a missing binary,
		// a timeout or a cancelled request is not the guest's recording.
		var exit *exec.ExitError
		if ctx.Err() == nil && errors.As(err, &exit) && exit.ExitCode() >= 0 {
			return guestbook.Voice{}, guestbook.ErrInvalidVoice
		}
		return guestbook.Voice{}, fmt.Errorf("voice encoding: %w", errors.Join(err, ctx.Err()))
	}
	duration, peaks := measure(waveform.Bytes())
	if duration <= 0 || duration > guestbook.MaxVoiceDuration {
		return guestbook.Voice{}, guestbook.ErrInvalidVoice
	}
	audio, err := readBounded(output, maxOutputBytes)
	if err != nil {
		return guestbook.Voice{}, err
	}
	return guestbook.Voice{Audio: audio, Duration: duration, Peaks: peaks}, nil
}

// detectFormat picks the demuxer from the content, never from a name or MIME type.
func detectFormat(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	header := make([]byte, 12)
	n, _ := io.ReadFull(file, header)
	header = header[:n]
	switch {
	case len(header) >= 8 && string(header[4:8]) == "ftyp":
		return "mov", nil
	case bytes.HasPrefix(header, []byte{0x1a, 0x45, 0xdf, 0xa3}):
		return "matroska", nil
	case bytes.HasPrefix(header, []byte("OggS")):
		return "ogg", nil
	}
	return "", guestbook.ErrInvalidVoice
}

func arguments(format, input, output string) []string {
	args := []string{
		"-hide_banner", "-nostdin", "-v", "error", "-max_alloc", "134217728",
		"-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,ogg",
		"-probesize", "5000000", "-analyzeduration", "5000000", "-max_streams", "4",
		"-threads", "2", "-f", format,
	}
	if format == "mov" {
		// MOV reference movies must not open another local file or remote URL.
		args = append(args, "-enable_drefs", "0", "-use_absolute_path", "0")
	}
	// Decoding stops just past the limit, so an overlong input fails quickly.
	limit := fmt.Sprintf("%.0f", guestbook.MaxVoiceDuration.Seconds()+1)
	return append(args, "-i", input,
		"-map", "0:a:0", "-t", limit, "-map_metadata", "-1", "-ac", "1", "-ar", "44100",
		"-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4", "-y", output,
		"-map", "0:a:0", "-t", limit, "-ac", "1", "-ar", fmt.Sprint(waveformRate),
		"-c:a", "pcm_s16le", "-f", "s16le", "pipe:1",
	)
}

// measure returns the length of 16-bit mono samples at waveformRate and their
// waveform: the loudest sample of each slice, relative to the loudest overall.
func measure(pcm []byte) (time.Duration, []byte) {
	samples := len(pcm) / 2
	duration := time.Duration(samples) * time.Second / waveformRate
	levels := make([]int, guestbook.VoicePeaks)
	loudest := 1
	for index := range samples {
		level := int(int16(binary.LittleEndian.Uint16(pcm[index*2:])))
		if level < 0 {
			level = -level
		}
		slice := index * guestbook.VoicePeaks / samples
		levels[slice] = max(levels[slice], level)
		loudest = max(loudest, level)
	}
	peaks := make([]byte, guestbook.VoicePeaks)
	for index, level := range levels {
		peaks[index] = byte(level * 255 / loudest)
	}
	return duration, peaks
}

func readBounded(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, guestbook.ErrInvalidVoice
	}
	return data, nil
}

// boundedBuffer keeps FFmpeg's raw output from growing past limit bytes.
type boundedBuffer struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		b.exceeded = true
		return 0, errors.New("voice waveform exceeds limit")
	}
	return b.Buffer.Write(p)
}
