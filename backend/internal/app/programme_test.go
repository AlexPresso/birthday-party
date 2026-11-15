package app

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestProgrammeListIsCompressedForClientsThatAcceptIt(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	for index := range 12 {
		status(t, request(t, a, "POST", "/api/admin/programme", map[string]any{"title": "Event " + strconv.Itoa(index), "description": strings.Repeat("A long description. ", 10)}, host), 201)
	}
	read := func(encoding string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/programme", nil)
		r.Header.Set("Accept-Encoding", encoding)
		r.AddCookie(host)
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		status(t, w, 200)
		return w
	}
	plain := read("")
	if plain.Header().Get("Content-Encoding") != "" || plain.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("plain response headers %v", plain.Header())
	}
	for _, refused := range []string{"gzip;q=0", "br, deflate"} {
		if read(refused).Header().Get("Content-Encoding") != "" {
			t.Fatalf("compressed for Accept-Encoding %q", refused)
		}
	}
	compressed := read("br, gzip;q=0.8")
	if compressed.Header().Get("Content-Encoding") != "gzip" || compressed.Body.Len() >= plain.Body.Len() {
		t.Fatalf("compressed response headers=%v size=%d plain=%d", compressed.Header(), compressed.Body.Len(), plain.Body.Len())
	}
	reader, err := gzip.NewReader(compressed.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(decoded, plain.Body.Bytes()) {
		t.Fatalf("decompressed body differs: %v", err)
	}
}

func BenchmarkCompressedProgramme(b *testing.B) {
	items := make([]map[string]any, 40)
	for index := range items {
		items[index] = map[string]any{"id": index, "title": "Event " + strconv.Itoa(index), "description": strings.Repeat("A long description. ", 25)}
	}
	r := httptest.NewRequest("GET", "/api/programme", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	b.ReportAllocs()
	for b.Loop() {
		respondCompressed(httptest.NewRecorder(), r, 200, map[string]any{"items": items})
	}
}
