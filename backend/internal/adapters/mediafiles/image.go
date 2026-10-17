package mediafiles

import (
	"birthday-party/backend/internal/media"
	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
)

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
	// Apply phone EXIF orientation, then flatten transparency onto dark plum.
	decoded, err := imaging.Decode(input, imaging.AutoOrientation(true))
	if err != nil {
		return preparedMedia{}, &media.Error{Code: "unreadable_photo"}
	}
	thumbnail := imaging.Fit(decoded, 720, 720, imaging.Linear)
	flat := image.NewRGBA(thumbnail.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.RGBA{R: 32, G: 19, B: 31, A: 255}}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumbnail, thumbnail.Bounds().Min, draw.Over)
	thumb, err := os.OpenFile(thumbnailPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return preparedMedia{}, err
	}
	encodeErr := jpeg.Encode(thumb, flat, &jpeg.Options{Quality: 82})
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
