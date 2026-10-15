package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func videoFixture(t *testing.T, format string) []byte {
	t.Helper()
	return videoFixtureDuration(t, format, "0.6")
}

func videoFixtureDuration(t *testing.T, format, duration string) []byte {
	t.Helper()
	for _, binary := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skip("video integration tests require ffmpeg and ffprobe")
		}
	}
	path := filepath.Join(t.TempDir(), "fixture."+format)
	videoCodec, audioCodec := "libx264", "aac"
	if format == "webm" {
		videoCodec, audioCodec = "libvpx-vp9", "libopus"
	}
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=purple:s=160x90:r=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", duration, "-c:v", videoCodec, "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", audioCodec, path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create video fixture: %v: %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func assertMediaFiles(t *testing.T, a *App, count int) {
	t.Helper()
	for directory, want := range map[string]int{"tmp": 0, "uploads": 0, "photos": count} {
		files, err := os.ReadDir(filepath.Join(a.config.DataDir, directory))
		if err != nil || len(files) != want {
			t.Fatalf("%s files=%d want=%d error=%v", directory, len(files), want, err)
		}
	}
}

func TestVideoUploadNormalizesContainersAndProtectsPlayback(t *testing.T) {
	for _, format := range []string{"mp4", "mov", "webm"} {
		t.Run(format, func(t *testing.T) {
			data := videoFixture(t, format)
			a := testApp(t)
			host, _ := admin(t, a)
			one, identity, _ := guest(t, a, host, "One")
			two, _, _ := guest(t, a, host, "Two")
			status(t, upload(t, a, nil, data), 401)
			response := upload(t, a, one, data)
			status(t, response, 201)
			var media Photo
			if err := json.Unmarshal(response.Body.Bytes(), &media); err != nil {
				t.Fatal(err)
			}
			if media.Kind != "video" || media.MIMEType != "video/mp4" || media.Width != 160 || media.Height != 90 {
				t.Fatalf("unexpected media metadata: %+v", media)
			}
			status(t, request(t, a, "GET", media.URL, nil, nil), 401)
			status(t, request(t, a, "HEAD", media.URL, nil, nil), 401)
			status(t, request(t, a, "GET", media.ThumbnailURL, nil, nil), 401)
			r := httptest.NewRequest("GET", media.URL, nil)
			r.AddCookie(two)
			r.Header.Set("Range", "bytes=0-31")
			partial := httptest.NewRecorder()
			a.Handler().ServeHTTP(partial, r)
			status(t, partial, 206)
			if partial.Body.Len() != 32 || !strings.HasPrefix(partial.Header().Get("Content-Range"), "bytes 0-31/") || partial.Header().Get("Content-Type") != "video/mp4" || partial.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("invalid private range response: %v", partial.Header())
			}
			thumb := request(t, a, "GET", media.ThumbnailURL, nil, two)
			status(t, thumb, 200)
			if _, format, err := image.DecodeConfig(bytes.NewReader(thumb.Body.Bytes())); err != nil || format != "jpeg" {
				t.Fatalf("invalid thumbnail: %s %v", format, err)
			}
			listed := request(t, a, "GET", "/api/photos", nil, two)
			status(t, listed, 200)
			if !strings.Contains(listed.Body.String(), `"kind":"video"`) || !strings.Contains(listed.Body.String(), `"mimeType":"video/mp4"`) {
				t.Fatal("listed video is missing its playback metadata")
			}
			var filename, thumbnail string
			var stored int64
			if err := a.db.QueryRow("SELECT filename,thumbnail,byte_size FROM photos WHERE id=$1", media.ID).Scan(&filename, &thumbnail, &stored); err != nil {
				t.Fatal(err)
			}
			var actual int64
			for _, name := range []string{filename, thumbnail} {
				info, err := os.Stat(filepath.Join(a.config.DataDir, "photos", name))
				if err != nil {
					t.Fatal(err)
				}
				actual += info.Size()
			}
			if stored != actual {
				t.Fatalf("stored quota=%d actual=%d", stored, actual)
			}
			probe, err := probeVideo(context.Background(), filepath.Join(a.config.DataDir, "photos", filename), "mov")
			if err != nil || len(probe.Streams) != 2 || probe.Streams[0].CodecName != "h264" || probe.Streams[1].CodecName != "aac" {
				t.Fatalf("video was not normalized: %+v %v", probe, err)
			}
			base := "/api/photos/" + strconv.FormatInt(media.ID, 10)
			status(t, request(t, a, "DELETE", base, nil, two), 403)
			status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
			status(t, request(t, a, "GET", media.URL, nil, one), 401)
			status(t, request(t, a, "DELETE", base, nil, host), 204)
			assertMediaFiles(t, a, 0)
		})
	}
}

func TestVideoValidationAndCleanup(t *testing.T) {
	data := videoFixture(t, "mp4")
	a := testApp(t)
	host, _ := admin(t, a)
	for _, invalid := range [][]byte{data[:32], []byte("#EXTM3U\nhttp://127.0.0.1/private"), []byte("file '/etc/passwd'\n")} {
		status(t, upload(t, a, host, invalid), 415)
		assertMediaFiles(t, a, 0)
	}
	imageResponse := upload(t, a, host, pngBytes(t))
	status(t, imageResponse, 201)
	if _, err := a.db.Exec("UPDATE photos SET byte_size=$1", maxStoredPhotoBytes); err != nil {
		t.Fatal(err)
	}
	response := upload(t, a, host, data)
	status(t, response, 409)
	if !strings.Contains(response.Body.String(), `"code":"album_full"`) {
		t.Fatal(response.Body.String())
	}
	assertMediaFiles(t, a, 2)
}

func TestVideoUploadRechecksRevokedIdentityBeforeCommit(t *testing.T) {
	data := videoFixture(t, "mp4")
	a := testApp(t)
	_, identity := admin(t, a)
	if _, err := a.db.Exec("UPDATE guests SET active=0 WHERE id=$1", identity.ID); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/photos", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	// Simulate revocation after the authentication middleware read this identity.
	a.uploadPhoto(w, r, identity)
	status(t, w, 401)
	if !strings.Contains(w.Body.String(), `"code":"access_revoked"`) {
		t.Fatal(w.Body.String())
	}
	assertMediaFiles(t, a, 0)
}

func TestVideoMetadataLimits(t *testing.T) {
	valid := `{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"300"},"streams":[{"codec_type":"video","codec_name":"hevc","width":2160,"height":3840}]}`
	for _, test := range []struct {
		name, source, code string
	}{
		{"portrait 4K boundary", valid, ""},
		{"too long", strings.Replace(valid, `"300"`, `"300.1"`, 1), "video_too_long"},
		{"oversized frame", strings.Replace(valid, `3840`, `9000`, 1), "video_dimensions_too_large"},
		{"invalid duration", strings.Replace(valid, `"300"`, `"NaN"`, 1), "unreadable_video"},
		{"no video", strings.Replace(valid, `"video"`, `"audio"`, 1), "unreadable_video"},
		{"playlist format", strings.Replace(valid, `mov,mp4,m4a,3gp,3g2,mj2`, `hls`, 1), "unreadable_video"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var probe videoProbe
			if err := json.Unmarshal([]byte(test.source), &probe); err != nil {
				t.Fatal(err)
			}
			_, _, err := probe.validate(maxVideoSeconds)
			if test.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var validation *mediaValidationError
			if !errors.As(err, &validation) || validation.code != test.code {
				t.Fatalf("validation=%v want=%s", err, test.code)
			}
		})
	}
}

func TestVideoDurationBoundary(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	status(t, upload(t, a, host, videoFixtureDuration(t, "mp4", "300")), 201)
	response := upload(t, a, host, videoFixtureDuration(t, "mp4", "300.2"))
	status(t, response, 413)
	if !strings.Contains(response.Body.String(), `"code":"video_too_long"`) {
		t.Fatal(response.Body.String())
	}
	assertMediaFiles(t, a, 2)
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestVideoSizeLimitStreamsAndRemovesTemporaryFile(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	var envelope bytes.Buffer
	writer := multipart.NewWriter(&envelope)
	if _, err := writer.CreateFormFile("file", "video.mp4"); err != nil {
		t.Fatal(err)
	}
	header := append([]byte(nil), envelope.Bytes()...)
	envelope.Reset()
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	magic := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p'}
	body := io.MultiReader(bytes.NewReader(header), bytes.NewReader(magic), io.LimitReader(zeroReader{}, defaultMaxVideoBytes-int64(len(magic))+1), &envelope)
	r := httptest.NewRequest("POST", "/api/photos", body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.AddCookie(host)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	status(t, w, http.StatusRequestEntityTooLarge)
	if !strings.Contains(w.Body.String(), `"code":"video_too_large"`) {
		t.Fatal(w.Body.String())
	}
	assertMediaFiles(t, a, 0)
}
