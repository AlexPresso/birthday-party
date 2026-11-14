package preview

import (
	"bufio"
	"encoding/binary"
	"image"
	"io"

	"github.com/disintegration/imaging"
)

// Orientation is a JPEG's EXIF orientation, 1 to 8; 1 shows pixels as stored.
type Orientation uint8

// Size returns the displayed width and height of a stored width × height.
func (o Orientation) Size(width, height int) (int, int) {
	if o >= 5 {
		return height, width
	}
	return width, height
}

// Apply turns img, usually an already reduced copy, the way it is displayed.
func (o Orientation) Apply(img *image.NRGBA) *image.NRGBA {
	switch o {
	case 2:
		return imaging.FlipH(img)
	case 3:
		return imaging.Rotate180(img)
	case 4:
		return imaging.FlipV(img)
	case 5:
		return imaging.Transpose(img)
	case 6:
		return imaging.Rotate270(img)
	case 7:
		return imaging.Transverse(img)
	case 8:
		return imaging.Rotate90(img)
	}
	return img
}

// jpegHeader is what the segments before a JPEG's first scan say about it.
type jpegHeader struct {
	orientation Orientation
	components  int
	progressive bool
}

// readJPEGHeader walks the marker segments up to the first scan. A malformed
// header leaves the defaults; the decoder then decides whether it is readable.
func readJPEGHeader(input io.Reader) jpegHeader {
	header := jpegHeader{orientation: 1}
	r := bufio.NewReader(input)
	var start [2]byte
	if _, err := io.ReadFull(r, start[:]); err != nil || start != [2]byte{0xff, 0xd8} {
		return header
	}
	exifSeen := false
	for {
		marker, err := nextMarker(r)
		if err != nil || marker == 0xda || marker == 0xd9 {
			return header
		}
		if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
			continue // Standalone markers carry no length.
		}
		var size [2]byte
		if _, err = io.ReadFull(r, size[:]); err != nil {
			return header
		}
		length := int(binary.BigEndian.Uint16(size[:]))
		if length < 2 {
			return header
		}
		segment := make([]byte, length-2)
		if _, err = io.ReadFull(r, segment); err != nil {
			return header
		}
		switch {
		case marker == 0xe1 && !exifSeen && len(segment) >= 6 && string(segment[:6]) == "Exif\x00\x00":
			exifSeen = true
			header.orientation = exifOrientation(segment[6:])
		case marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc:
			if len(segment) >= 6 {
				header.components = int(segment[5])
				header.progressive = marker == 0xc2 || marker == 0xc6 || marker == 0xca || marker == 0xce
			}
		}
	}
}

// nextMarker skips fill bytes and returns the code following 0xFF.
func nextMarker(r *bufio.Reader) (byte, error) {
	first, err := r.ReadByte()
	if err != nil {
		return 0, err
	}
	if first != 0xff {
		return 0, io.ErrUnexpectedEOF
	}
	for {
		code, err := r.ReadByte()
		if err != nil || code != 0xff {
			return code, err
		}
	}
}

// exifOrientation reads the orientation tag of a TIFF structure's first IFD.
func exifOrientation(tiff []byte) Orientation {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	offset := int64(order.Uint32(tiff[4:8]))
	if offset < 8 || offset+2 > int64(len(tiff)) {
		return 1
	}
	count := int(order.Uint16(tiff[offset:]))
	entries := tiff[offset+2:]
	for index := 0; index < count && (index+1)*12 <= len(entries); index++ {
		entry := entries[index*12:]
		if order.Uint16(entry) != 0x0112 {
			continue
		}
		if value := order.Uint16(entry[8:]); value >= 1 && value <= 8 {
			return Orientation(value)
		}
		return 1
	}
	return 1
}
