package mediafiles

import (
	"bytes"
	"testing"
)

func TestOriginalQuickTimeAndMP4Types(t *testing.T) {
	for _, test := range []struct {
		brand, extension, mime string
	}{
		{"qt  ", "mov", "video/quicktime"},
		{"", "mov", "video/quicktime"},
		{"isom", "mp4", "video/mp4"},
		{"mp42", "mp4", "video/mp4"},
	} {
		t.Run(test.brand, func(t *testing.T) {
			var probe videoProbe
			probe.Format.Name = "mov,mp4,m4a,3gp,3g2,mj2"
			probe.Format.Tags.MajorBrand = test.brand
			extension, mime, err := originalVideoType("", probe)
			if err != nil || extension != test.extension || mime != test.mime {
				t.Fatalf("original type = %q %q, %v; want %q %q", extension, mime, err, test.extension, test.mime)
			}
		})
	}
}

func TestWebMDocTypeUsesBoundedHeaderElements(t *testing.T) {
	for _, test := range []struct {
		name, header string
		webm         bool
	}{
		{"webm", "\x1a\x45\xdf\xa3\x87\x42\x82\x84webm", true},
		{"preceding element", "\x1a\x45\xdf\xa3\x8b\x42\x86\x81\x01\x42\x82\x84webm", true},
		{"two-byte length", "\x1a\x45\xdf\xa3\x40\x07\x42\x82\x84webm", true},
		{"matroska", "\x1a\x45\xdf\xa3\x8b\x42\x82\x88matroska", false},
		{"embedded in void payload", "\x1a\x45\xdf\xa3\x89\xec\x87\x42\x82\x84webm", false},
		{"outside the header", "\x1a\x45\xdf\xa3\x80\x42\x82\x84webm", false},
		{"truncated element", "\x1a\x45\xdf\xa3\x87\x42\x82\x84web", false},
		{"invalid element size", "\x1a\x45\xdf\xa3\x87\x42\x82\x00webm", false},
		{"truncated header size", "\x1a\x45\xdf\xa3\x40", false},
		{"empty input", "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := hasWebMDocType([]byte(test.header)); got != test.webm {
				t.Fatalf("WebM DocType = %v, want %v", got, test.webm)
			}
		})
	}
}

func FuzzWebMDocType(f *testing.F) {
	f.Add([]byte("\x1a\x45\xdf\xa3\x87\x42\x82\x84webm"))
	f.Add([]byte("\x1a\x45\xdf\xa3\x8b\x42\x82\x88matroska"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, header []byte) {
		if hasWebMDocType(header) && !bytes.Contains(header, []byte("webm")) {
			t.Fatal("WebM identification requires its declared document type")
		}
	})
}
