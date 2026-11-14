package preview

import (
	"context"
	"errors"
	"image"
	"image/color"
	"io"
	"sync"

	"golang.org/x/sync/semaphore"
)

// ErrUnreadable reports pixels that could not be decoded.
var ErrUnreadable = errors.New("unreadable image")

// decodeOverhead covers decoder buffers and the reduced copies derived while
// resizing, which stay small because previews are resized before orienting.
const decodeOverhead = 32 << 20

// DecodeBudget bounds the memory held by full-size decoded images, shared by
// gallery processing and profile photos. A decode waits until its estimate
// fits, so ordinary phone photos run side by side while huge ones take turns.
// A decode estimated above the whole budget runs alone.
type DecodeBudget struct {
	bytes int64
	slots *semaphore.Weighted
}

func NewDecodeBudget(bytes int64) *DecodeBudget {
	return &DecodeBudget{bytes: bytes, slots: semaphore.NewWeighted(bytes)}
}

// Decoded is a full-size image whose EXIF orientation applies to the small
// images derived from it, which avoids a second full-size copy.
type Decoded struct {
	image.Image
	Orientation Orientation
}

// Decode waits for memory, then decodes input from its start. config and
// format are the caller's validated image.DecodeConfig result. The caller
// calls release once it no longer uses the image.
func (b *DecodeBudget) Decode(ctx context.Context, input io.ReadSeeker, config image.Config, format string) (Decoded, func(), error) {
	header := jpegHeader{orientation: 1}
	if format == "jpeg" {
		if _, err := input.Seek(0, io.SeekStart); err != nil {
			return Decoded{}, nil, err
		}
		header = readJPEGHeader(input)
	}
	cost := min(decodeCost(config, header), b.bytes)
	if err := b.slots.Acquire(ctx, cost); err != nil {
		return Decoded{}, nil, err
	}
	release := sync.OnceFunc(func() { b.slots.Release(cost) })
	if _, err := input.Seek(0, io.SeekStart); err != nil {
		release()
		return Decoded{}, nil, err
	}
	decoded, _, err := image.Decode(input)
	if err != nil {
		release()
		return Decoded{}, nil, ErrUnreadable
	}
	return Decoded{Image: decoded, Orientation: header.orientation}, release, nil
}

// decodeCost estimates the bytes the standard decoders allocate for config.
func decodeCost(config image.Config, header jpegHeader) int64 {
	perPixel := int64(4)
	switch config.ColorModel {
	case color.GrayModel:
		perPixel = 1
	case color.Gray16Model:
		perPixel = 2
	case color.RGBA64Model, color.NRGBA64Model:
		perPixel = 8
	case color.YCbCrModel:
		perPixel = 3
	}
	if _, paletted := config.ColorModel.(color.Palette); paletted {
		perPixel = 1
	}
	if header.components > 0 {
		// One byte per component sample, assuming no chroma subsampling. A
		// progressive scan also keeps four bytes of coefficients per sample, and
		// CMYK is converted into a second four-byte image.
		perPixel = int64(header.components)
		if header.progressive {
			perPixel += 4 * int64(header.components)
		}
		if header.components == 4 {
			perPixel += 4
		}
	}
	return int64(config.Width)*int64(config.Height)*perPixel + decodeOverhead
}
