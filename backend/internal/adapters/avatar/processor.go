// Package avatar normalizes profile images with bounded dimensions and output.
package avatar

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"

	"birthday-party/backend/internal/profile"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

type Processor struct{}

func New() *Processor { return &Processor{} }

var _ profile.Processor = (*Processor)(nil)

func (p *Processor) Prepare(ctx context.Context, input io.ReadSeeker) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	config, format, err := image.DecodeConfig(input)
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return nil, profile.Error("unsupported_profile_photo_type")
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, profile.Error("photo_dimensions_too_large")
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	decoded, err := imaging.Decode(input, imaging.AutoOrientation(true))
	if err != nil {
		return nil, profile.Error("unreadable_photo")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	// Crop before resizing so narrow images cannot create oversized intermediate
	// allocations when scaled to fill the square.
	side := min(decoded.Bounds().Dx(), decoded.Bounds().Dy())
	square := imaging.CropCenter(decoded, side, side)
	thumbnail := imaging.Resize(square, 256, 256, imaging.Linear)
	flat := image.NewRGBA(thumbnail.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.RGBA{R: 32, G: 19, B: 31, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumbnail, thumbnail.Bounds().Min, draw.Over)
	var encoded bytes.Buffer
	// Re-encoding only pixels strips EXIF and other original metadata.
	if err = jpeg.Encode(&encoded, flat, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	if encoded.Len() > profile.MaxAvatarBytes {
		return nil, errors.New("normalized avatar exceeded its storage limit")
	}
	return encoded.Bytes(), ctx.Err()
}
