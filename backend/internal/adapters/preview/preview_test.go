package preview

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func TestTransparentPixelsTakeTheThemeBackground(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for x := range 8 {
		for y := range 16 {
			source.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := EncodeJPEG(&encoded, source); err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(&encoded)
	if err != nil {
		t.Fatal(err)
	}
	near := func(got color.Color, want color.RGBA) bool {
		r, g, b, _ := got.RGBA()
		distance := func(a uint32, b uint8) int { return max(int(a>>8), int(b)) - min(int(a>>8), int(b)) }
		return distance(r, want.R) <= 6 && distance(g, want.G) <= 6 && distance(b, want.B) <= 6
	}
	if !near(decoded.At(14, 8), background) {
		t.Fatalf("transparent pixel became %v, want %v", decoded.At(14, 8), background)
	}
	if !near(decoded.At(1, 8), color.RGBA{R: 255, G: 255, B: 255, A: 255}) {
		t.Fatalf("opaque pixel became %v", decoded.At(1, 8))
	}
}
