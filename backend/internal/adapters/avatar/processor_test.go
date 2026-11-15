package avatar

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
	"time"

	"birthday-party/backend/internal/adapters/preview"
	"birthday-party/backend/internal/profile"
)

func TestProfilePhotoNormalizesDimensionsOrientationAndMetadata(t *testing.T) {
	var large bytes.Buffer
	if err := png.Encode(&large, image.NewRGBA(image.Rect(0, 0, 800, 400))); err != nil {
		t.Fatal(err)
	}
	var jpegData bytes.Buffer
	phoneImage := image.NewRGBA(image.Rect(0, 0, 12, 8))
	for y := range 8 {
		for x := range 12 {
			pixel := color.RGBA{R: 255, A: 255}
			if x >= 6 {
				pixel = color.RGBA{B: 255, A: 255}
			}
			phoneImage.SetRGBA(x, y, pixel)
		}
	}
	if err := jpeg.Encode(&jpegData, phoneImage, nil); err != nil {
		t.Fatal(err)
	}
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	oriented := append([]byte{}, jpegData.Bytes()[:2]...)
	oriented = append(oriented, 0xff, 0xe1, byte((len(exif)+2)>>8), byte(len(exif)+2))
	oriented = append(oriented, exif...)
	oriented = append(oriented, jpegData.Bytes()[2:]...)
	webp, err := base64.StdEncoding.DecodeString("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name          string
		data          []byte
		width, height int
	}{
		{"PNG resize", large.Bytes(), 256, 256},
		{"phone JPEG", oriented, 256, 256},
		{"WebP", webp, 256, 256},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, err := processor().Prepare(t.Context(), bytes.NewReader(test.data))
			if err != nil {
				t.Fatal(err)
			}
			config, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || format != "jpeg" || config.Width != test.width || config.Height != test.height || len(data) > profile.MaxAvatarBytes || bytes.Contains(data, []byte("Exif")) {
				t.Fatalf("unexpected normalization: config=%+v format=%s size=%d error=%v", config, format, len(data), err)
			}
			if test.name == "phone JPEG" {
				decoded, err := jpeg.Decode(bytes.NewReader(data))
				if err != nil {
					t.Fatal(err)
				}
				redTop, _, blueTop, _ := decoded.At(128, 64).RGBA()
				redBottom, _, blueBottom, _ := decoded.At(128, 192).RGBA()
				if redTop <= blueTop || blueBottom <= redBottom {
					t.Fatal("phone orientation was not applied before cropping")
				}
			}
		})
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := processor().Prepare(cancelled, bytes.NewReader(large.Bytes())); err != context.Canceled {
		t.Fatalf("cancelled processing error=%v", err)
	}
}

func TestProfilePhotoExtremeAspectRatiosStayBounded(t *testing.T) {
	for _, dimensions := range []image.Point{{X: 10000, Y: 1}, {X: 1, Y: 10000}} {
		var input bytes.Buffer
		if err := png.Encode(&input, image.NewRGBA(image.Rect(0, 0, dimensions.X, dimensions.Y))); err != nil {
			t.Fatal(err)
		}
		data, err := processor().Prepare(t.Context(), bytes.NewReader(input.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width != 256 || config.Height != 256 || len(data) > profile.MaxAvatarBytes {
			t.Fatalf("unexpected normalization for %v: config=%+v size=%d error=%v", dimensions, config, len(data), err)
		}
	}
}

func processor() *Processor { return New(preview.NewDecodeBudget(256 << 20)) }

func TestProfilePhotosWaitForDecodeMemory(t *testing.T) {
	var input bytes.Buffer
	if err := png.Encode(&input, image.NewRGBA(image.Rect(0, 0, 64, 48))); err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(input.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	// A one-byte budget admits a single decode at a time.
	budget := preview.NewDecodeBudget(1)
	_, release, err := budget.Decode(t.Context(), bytes.NewReader(input.Bytes()), config, "png")
	if err != nil {
		t.Fatal(err)
	}
	waiting := New(budget)
	done := make(chan error, 1)
	go func() {
		_, err := waiting.Prepare(t.Context(), bytes.NewReader(input.Bytes()))
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("photo was not held while memory was in use: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	release()
	if err := <-done; err != nil {
		t.Fatalf("waiting photo failed once memory was free: %v", err)
	}

	_, release, err = budget.Decode(t.Context(), bytes.NewReader(input.Bytes()), config, "png")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	impatient := New(budget)
	impatient.wait = time.Millisecond
	if _, err := impatient.Prepare(t.Context(), bytes.NewReader(input.Bytes())); err != profile.Error("profile_photo_busy") {
		t.Fatalf("long wait error=%v", err)
	}
}
