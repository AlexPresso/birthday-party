package mediafiles

import (
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"

	"birthday-party/backend/internal/adapters/preview"
	"birthday-party/backend/internal/media"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const thumbnailSide = 720

type preparedMedia struct {
	path, thumbnailPath, mimeType, extension string
	width, height                            int
}

func prepareImage(ctx context.Context, budget *preview.DecodeBudget, input *os.File, thumbnailPath string) (preparedMedia, error) {
	config, format, err := image.DecodeConfig(input)
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") {
		return preparedMedia{}, &media.Error{Code: "unsupported_photo_type"}
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > media.MaxPhotoPixels {
		return preparedMedia{}, &media.Error{Code: "photo_dimensions_too_large"}
	}
	if _, err = input.Seek(0, io.SeekStart); err != nil {
		return preparedMedia{}, err
	}
	decoded, release, err := budget.Decode(ctx, input, config, format)
	if errors.Is(err, preview.ErrUnreadable) {
		return preparedMedia{}, &media.Error{Code: "unreadable_photo"}
	}
	if err != nil {
		return preparedMedia{}, err
	}
	defer release()
	thumb, err := os.OpenFile(thumbnailPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return preparedMedia{}, err
	}
	// Shrink first and apply the phone's EXIF orientation to the thumbnail only,
	// so a rotated photo never needs a second full-size copy.
	small := imaging.Fit(decoded.Image, thumbnailSide, thumbnailSide, imaging.Linear)
	encodeErr := preview.EncodeJPEG(thumb, decoded.Orientation.Apply(small))
	closeErr := thumb.Close()
	if encodeErr != nil {
		return preparedMedia{}, encodeErr
	}
	if closeErr != nil {
		return preparedMedia{}, closeErr
	}
	width, height := decoded.Orientation.Size(decoded.Bounds().Dx(), decoded.Bounds().Dy())
	return preparedMedia{
		path: input.Name(), thumbnailPath: thumbnailPath, mimeType: "image/" + format,
		extension: map[string]string{"jpeg": "jpg", "png": "png", "webp": "webp"}[format],
		width:     width, height: height,
	}, nil
}
