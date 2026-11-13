// Package preview encodes derived images, such as gallery thumbnails and
// avatars, as opaque JPEGs.
package preview

import (
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
)

const jpegQuality = 82

// background is the application's dark surface (#100F0E). Transparent pixels
// take this colour because JPEG has no alpha channel.
var background = color.RGBA{R: 0x10, G: 0x0F, B: 0x0E, A: 0xFF}

// EncodeJPEG flattens source onto the background and writes it as a JPEG.
// Only pixels are encoded, so the output carries no EXIF or other metadata.
func EncodeJPEG(w io.Writer, source image.Image) error {
	flat := image.NewRGBA(source.Bounds())
	draw.Draw(flat, flat.Bounds(), image.NewUniform(background), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), source, source.Bounds().Min, draw.Over)
	return jpeg.Encode(w, flat, &jpeg.Options{Quality: jpegQuality})
}
