package mediafiles

import (
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

func prepareImage(input *os.File, thumbnailPath string) (preparedMedia, error) {
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
	// Apply phone EXIF orientation before measuring and resizing.
	decoded, err := imaging.Decode(input, imaging.AutoOrientation(true))
	if err != nil {
		return preparedMedia{}, &media.Error{Code: "unreadable_photo"}
	}
	thumb, err := os.OpenFile(thumbnailPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return preparedMedia{}, err
	}
	encodeErr := preview.EncodeJPEG(thumb, imaging.Fit(decoded, thumbnailSide, thumbnailSide, imaging.Linear))
	closeErr := thumb.Close()
	if encodeErr != nil {
		return preparedMedia{}, encodeErr
	}
	if closeErr != nil {
		return preparedMedia{}, closeErr
	}
	return preparedMedia{
		path: input.Name(), thumbnailPath: thumbnailPath, mimeType: "image/" + format,
		extension: map[string]string{"jpeg": "jpg", "png": "png", "webp": "webp"}[format],
		width:     decoded.Bounds().Dx(), height: decoded.Bounds().Dy(),
	}, nil
}
