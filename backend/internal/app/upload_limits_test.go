package app

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestUploadLimitsFromEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://unused/unused")
	t.Setenv("PUBLIC_URL", "http://localhost:3000")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("PRINT_ADMIN_INVITATION", "false")
	for _, test := range []struct {
		name, image, video     string
		imageBytes, videoBytes int64
	}{
		{"defaults", "", "", defaultMaxImageBytes, defaultMaxVideoBytes},
		{"custom", "32", "250", 32 << 20, 250 << 20},
		{"boundaries", "1024", "1", 1024 << 20, 1 << 20},
		{"leading zeros", "015", "0100", defaultMaxImageBytes, defaultMaxVideoBytes},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("MAX_IMAGE_SIZE_MB", test.image)
			t.Setenv("MAX_VIDEO_SIZE_MB", test.video)
			config, err := ConfigFromEnv()
			if err != nil || config.MaxImageBytes != test.imageBytes || config.MaxVideoBytes != test.videoBytes {
				t.Fatalf("config=%+v error=%v", config, err)
			}
		})
	}
	t.Run("missing values", func(t *testing.T) {
		for _, key := range []string{"MAX_IMAGE_SIZE_MB", "MAX_VIDEO_SIZE_MB"} {
			t.Setenv(key, "")
			if err := os.Unsetenv(key); err != nil {
				t.Fatal(err)
			}
		}
		config, err := ConfigFromEnv()
		if err != nil || config.MaxImageBytes != defaultMaxImageBytes || config.MaxVideoBytes != defaultMaxVideoBytes {
			t.Fatalf("missing limits: %+v %v", config, err)
		}
	})
	for _, key := range []string{"MAX_IMAGE_SIZE_MB", "MAX_VIDEO_SIZE_MB"} {
		for _, value := range []string{"0", "-1", "+1", "1025", "1.5", "15MB", " 15", "15 ", "10000000000000000000000000000"} {
			t.Run(key+"="+value, func(t *testing.T) {
				t.Setenv("MAX_IMAGE_SIZE_MB", "")
				t.Setenv("MAX_VIDEO_SIZE_MB", "")
				t.Setenv(key, value)
				_, err := ConfigFromEnv()
				if err == nil || err.Error() != key+" must be an integer between 1 and 1024" {
					t.Fatalf("invalid limit was not rejected clearly: %v", err)
				}
			})
		}
	}
}

func TestOpenValidatesUploadLimitsAndGalleryExposesThem(t *testing.T) {
	for _, test := range []struct {
		name                   string
		imageBytes, videoBytes int64
	}{
		{"defaults", 0, 0},
		{"custom", 32 << 20, 1 << 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, err := Open(Config{PublicURL: "http://localhost:3000", DataDir: t.TempDir(), DatabaseURL: testDatabaseURL(t), MaxImageBytes: test.imageBytes, MaxVideoBytes: test.videoBytes})
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			host, _ := admin(t, a)
			response := request(t, a, "GET", "/api/photos", nil, host)
			status(t, response, 200)
			var page struct {
				Limits struct {
					ImageBytes int64 `json:"imageBytes"`
					VideoBytes int64 `json:"videoBytes"`
				} `json:"limits"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			wantImage, wantVideo := test.imageBytes, test.videoBytes
			if wantImage == 0 {
				wantImage = defaultMaxImageBytes
			}
			if wantVideo == 0 {
				wantVideo = defaultMaxVideoBytes
			}
			if page.Limits.ImageBytes != wantImage || page.Limits.VideoBytes != wantVideo {
				t.Fatalf("gallery limits=%+v want=%d,%d", page.Limits, wantImage, wantVideo)
			}
		})
	}
	for _, value := range []int64{-1, 1, maxConfiguredUploadBytes + 1} {
		for _, field := range []string{"image", "video"} {
			config := Config{DataDir: t.TempDir()}
			if field == "image" {
				config.MaxImageBytes = value
			} else {
				config.MaxVideoBytes = value
			}
			if a, err := Open(config); err == nil {
				a.Close()
				t.Fatalf("invalid %s configuration accepted: %d", field, value)
			}
		}
	}
}

func uploadStream(t *testing.T, a *App, cookie *http.Cookie, data io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	var envelope bytes.Buffer
	writer := multipart.NewWriter(&envelope)
	if _, err := writer.CreateFormFile("file", "untrusted-name"); err != nil {
		t.Fatal(err)
	}
	header := append([]byte(nil), envelope.Bytes()...)
	envelope.Reset()
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/photos", io.MultiReader(bytes.NewReader(header), data, &envelope))
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return completeTestUpload(t, a, cookie, w)
}

func TestConfiguredImageLimitCanExceedVideoLimitAndOldDefault(t *testing.T) {
	a := testApp(t)
	a.config.MaxImageBytes, a.config.MaxVideoBytes = 16<<20, 1<<20
	host, _ := admin(t, a)
	data := pngBytes(t)
	padded := func(size int64) io.Reader {
		return io.MultiReader(bytes.NewReader(data), io.LimitReader(zeroReader{}, size-int64(len(data))))
	}
	// PNG decoding permits trailing data, giving a large valid fixture without costly pixels.
	status(t, uploadStream(t, a, host, padded(a.config.MaxImageBytes)), 201)
	response := uploadStream(t, a, host, padded(a.config.MaxImageBytes+1))
	status(t, response, 413)
	if !strings.Contains(response.Body.String(), `"code":"photo_too_large"`) {
		t.Fatal(response.Body.String())
	}
	assertMediaFiles(t, a, 2)
	a.config.MaxImageBytes = 1 << 20
	status(t, uploadStream(t, a, host, padded((1<<20)+1)), 413)
	assertMediaFiles(t, a, 2)
}

func TestConfiguredVideoLimitCanExceedOldDefault(t *testing.T) {
	data := videoFixture(t, "mp4")
	a := testApp(t)
	a.config.MaxImageBytes, a.config.MaxVideoBytes = 1<<20, 101<<20
	host, _ := admin(t, a)
	padded := func(size int64) io.Reader {
		freeBox := make([]byte, 8)
		binary.BigEndian.PutUint32(freeBox, uint32(size-int64(len(data))))
		copy(freeBox[4:], "free")
		return io.MultiReader(bytes.NewReader(data), bytes.NewReader(freeBox), io.LimitReader(zeroReader{}, size-int64(len(data))-8))
	}
	// A valid MP4 free box enlarges the input while preserving the short encoded clip.
	status(t, uploadStream(t, a, host, padded(a.config.MaxVideoBytes)), 201)
	response := uploadStream(t, a, host, padded(a.config.MaxVideoBytes+1))
	status(t, response, 413)
	if !strings.Contains(response.Body.String(), `"code":"video_too_large"`) {
		t.Fatal(response.Body.String())
	}
	assertMediaFiles(t, a, 2)
	a.config.MaxVideoBytes = 1 << 20
	status(t, uploadStream(t, a, host, padded((1<<20)+1)), 413)
	assertMediaFiles(t, a, 2)
}

func TestConfiguredVideoLimitAppliesToInputBeforeConversion(t *testing.T) {
	data := videoFixtureDuration(t, "mp4", "90")
	if len(data) >= 1<<20 {
		t.Fatalf("input fixture must fit the configured 1 MiB limit: %d bytes", len(data))
	}
	a := testApp(t)
	a.config.MaxVideoBytes = 1 << 20
	host, _ := admin(t, a)
	response := upload(t, a, host, data)
	status(t, response, 201)
	var stored int64
	if err := a.db.QueryRow("SELECT byte_size FROM photos").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored <= a.config.MaxVideoBytes {
		t.Fatalf("fixture must exercise output growth: stored=%d limit=%d", stored, a.config.MaxVideoBytes)
	}
	assertMediaFiles(t, a, 2)
}
