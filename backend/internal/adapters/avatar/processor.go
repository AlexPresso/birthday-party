// Package avatar normalizes profile images with bounded dimensions and output.
package avatar

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"time"

	"birthday-party/backend/internal/adapters/preview"
	"birthday-party/backend/internal/profile"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

// maxWait bounds how long a photo waits for decode memory before the guest is
// asked to retry. Ordinary photos decode in well under a second each.
const maxWait = 20 * time.Second

type Processor struct {
	budget *preview.DecodeBudget
	wait   time.Duration
}

func New(budget *preview.DecodeBudget) *Processor {
	return &Processor{budget: budget, wait: maxWait}
}

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
	wait, cancel := context.WithTimeout(ctx, p.wait)
	decoded, release, err := p.budget.Decode(wait, input, config, format)
	cancel()
	switch {
	case errors.Is(err, preview.ErrUnreadable):
		return nil, profile.Error("unreadable_photo")
	case err != nil && ctx.Err() != nil:
		return nil, ctx.Err()
	case errors.Is(err, context.DeadlineExceeded):
		return nil, profile.Error("profile_photo_busy")
	case err != nil:
		return nil, err
	}
	defer release()
	// Crop the stored pixels without copying them, then shrink and orient only
	// the small result: a centered square stays centered whatever the rotation.
	bounds := decoded.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	square := imaging.Resize(centerSquare(decoded.Image, side), 256, 256, imaging.Linear)
	thumbnail := decoded.Orientation.Apply(square)
	var encoded bytes.Buffer
	// Re-encoding only pixels strips EXIF and other original metadata.
	if err = preview.EncodeJPEG(&encoded, thumbnail); err != nil {
		return nil, err
	}
	if encoded.Len() > profile.MaxAvatarBytes {
		return nil, errors.New("normalized avatar exceeded its storage limit")
	}
	return encoded.Bytes(), ctx.Err()
}

// centerSquare returns the centered side × side area of img, sharing its
// pixels when the decoder's image type allows it.
func centerSquare(img image.Image, side int) image.Image {
	bounds := img.Bounds()
	area := image.Rect(0, 0, side, side).Add(bounds.Min).Add(image.Pt((bounds.Dx()-side)/2, (bounds.Dy()-side)/2))
	if shared, ok := img.(interface {
		SubImage(image.Rectangle) image.Image
	}); ok {
		return shared.SubImage(area)
	}
	return imaging.Crop(img, area)
}
