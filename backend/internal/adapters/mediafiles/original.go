package mediafiles

import (
	"bytes"
	"io"
	"math/bits"
	"os"
	"strings"
)

func originalVideoType(path string, probe videoProbe) (extension, mimeType string, err error) {
	if probe.Format.Name == "mov,mp4,m4a,3gp,3g2,mj2" {
		// Older QuickTime files can omit ftyp; MP4 carries a major brand.
		brand := strings.TrimSpace(probe.Format.Tags.MajorBrand)
		if brand == "" || brand == "qt" {
			return "mov", "video/quicktime", nil
		}
		return "mp4", "video/mp4", nil
	}
	input, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer input.Close()
	header := make([]byte, 4096)
	n, err := io.ReadFull(input, header)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", "", err
	}
	if hasWebMDocType(header[:n]) {
		return "webm", "video/webm", nil
	}
	// FFmpeg accepts Matroska too. Preserve it without labeling it as WebM.
	return "mkv", "video/x-matroska", nil
}

// Read only EBML header elements; a matching byte sequence in a payload is not a DocType.
func hasWebMDocType(header []byte) bool {
	if !bytes.HasPrefix(header, []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		return false
	}
	size, width := ebmlSize(header[4:])
	if width == 0 {
		return false
	}
	header = header[4+width:]
	if size < uint64(len(header)) {
		header = header[:size]
	}
	for len(header) > 0 {
		idWidth := bits.LeadingZeros8(header[0]) + 1
		if idWidth > 4 || idWidth > len(header) {
			return false
		}
		isDocType := bytes.Equal(header[:idWidth], []byte{0x42, 0x82})
		size, width = ebmlSize(header[idWidth:])
		if width == 0 {
			return false
		}
		header = header[idWidth+width:]
		if size > uint64(len(header)) {
			return false
		}
		if isDocType {
			return bytes.Equal(header[:size], []byte("webm"))
		}
		header = header[size:]
	}
	return false
}

func ebmlSize(data []byte) (uint64, int) {
	if len(data) == 0 {
		return 0, 0
	}
	width := bits.LeadingZeros8(data[0]) + 1
	if width > 8 || width > len(data) {
		return 0, 0
	}
	value := uint64(data[0] & (0xff >> width))
	for _, b := range data[1:width] {
		value = value<<8 | uint64(b)
	}
	return value, width
}
