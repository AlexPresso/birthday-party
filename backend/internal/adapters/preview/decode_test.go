package preview

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

// phoneJPEG returns a baseline JPEG carrying an EXIF orientation, the way
// phones store portrait photos.
func phoneJPEG(t *testing.T, orientation uint16, order binary.ByteOrder) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 40, 20)), nil); err != nil {
		t.Fatal(err)
	}
	tiff := make([]byte, 26)
	if order == binary.LittleEndian {
		copy(tiff, "II")
	} else {
		copy(tiff, "MM")
	}
	order.PutUint16(tiff[2:], 42)
	order.PutUint32(tiff[4:], 8)
	order.PutUint16(tiff[8:], 1)       // One entry.
	order.PutUint16(tiff[10:], 0x0112) // Orientation.
	order.PutUint16(tiff[12:], 3)      // SHORT.
	order.PutUint32(tiff[14:], 1)
	order.PutUint16(tiff[18:], orientation)
	segment := append([]byte("Exif\x00\x00"), tiff...)
	app1 := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(app1[2:], uint16(len(segment)+2))
	data := encoded.Bytes()
	return append(append(append([]byte{}, data[:2]...), append(app1, segment...)...), data[2:]...)
}

func TestJPEGHeaderReadsOrientationAndLayout(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.BigEndian, binary.LittleEndian} {
		header := readJPEGHeader(bytes.NewReader(phoneJPEG(t, 6, order)))
		if header.orientation != 6 || header.components != 3 || header.progressive {
			t.Fatalf("%v header=%+v", order, header)
		}
	}
	for _, input := range [][]byte{nil, []byte("not a jpeg"), phoneJPEG(t, 9, binary.BigEndian)[:30]} {
		if header := readJPEGHeader(bytes.NewReader(input)); header.orientation != 1 {
			t.Fatalf("malformed header gave orientation %d", header.orientation)
		}
	}
}

func TestDecodedPhoneJPEGReportsDisplayedSize(t *testing.T) {
	data := phoneJPEG(t, 6, binary.BigEndian)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	decoded, release, err := NewDecodeBudget(64<<20).Decode(t.Context(), bytes.NewReader(data), config, format)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if width, height := decoded.Orientation.Size(40, 20); width != 20 || height != 40 {
		t.Fatalf("displayed size %dx%d", width, height)
	}
	if bounds := decoded.Orientation.Apply(image.NewNRGBA(image.Rect(0, 0, 40, 20))).Bounds(); bounds.Dx() != 20 || bounds.Dy() != 40 {
		t.Fatalf("oriented preview %v", bounds)
	}
}

func TestDecodeCostFollowsTheDecodedLayout(t *testing.T) {
	config := image.Config{Width: 1000, Height: 1000}
	for _, test := range []struct {
		name   string
		model  color.Model
		header jpegHeader
		want   int64
	}{
		{"gray PNG", color.GrayModel, jpegHeader{}, 1},
		{"RGBA PNG", color.NRGBAModel, jpegHeader{}, 4},
		{"16-bit PNG", color.NRGBA64Model, jpegHeader{}, 8},
		{"paletted PNG", color.Palette{color.Black}, jpegHeader{}, 1},
		{"baseline JPEG", color.YCbCrModel, jpegHeader{components: 3}, 3},
		{"progressive JPEG", color.YCbCrModel, jpegHeader{components: 3, progressive: true}, 15},
		{"CMYK JPEG", color.CMYKModel, jpegHeader{components: 4}, 8},
	} {
		config.ColorModel = test.model
		if got := decodeCost(config, test.header) - decodeOverhead; got != test.want*1_000_000 {
			t.Errorf("%s cost=%d want %d per pixel", test.name, got, test.want)
		}
	}
}
