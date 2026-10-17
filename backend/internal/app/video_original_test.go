package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func assertMediaDownload(t *testing.T, a *App, cookie *http.Cookie, photo Photo, original []byte, mime, extension string) {
	t.Helper()
	path := photo.URL + "?download=1"
	disposition := fmt.Sprintf("attachment; filename=\"media-%d.%s\"", photo.ID, extension)
	for _, method := range []string{"GET", "HEAD"} {
		response := request(t, a, method, path, nil, cookie)
		status(t, response, 200)
		if response.Header().Get("Content-Type") != mime || response.Header().Get("Content-Disposition") != disposition || response.Header().Get("Content-Length") != strconv.Itoa(len(original)) || response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("incorrect %s download headers: %v", method, response.Header())
		}
		if method == "GET" && !bytes.Equal(response.Body.Bytes(), original) {
			t.Fatalf("download changed original bytes: received=%d original=%d", response.Body.Len(), len(original))
		}
		if method == "HEAD" && response.Body.Len() != 0 {
			t.Fatal("HEAD download returned a body")
		}
	}
	r := httptest.NewRequest("GET", path, nil)
	r.AddCookie(cookie)
	r.Header.Set("Range", "bytes=0-31")
	partial := performMediaUpload(a, r)
	status(t, partial, 206)
	if !bytes.Equal(partial.Body.Bytes(), original[:32]) || partial.Header().Get("Content-Range") != fmt.Sprintf("bytes 0-31/%d", len(original)) || partial.Header().Get("Content-Type") != mime || partial.Header().Get("Content-Disposition") != disposition {
		t.Fatalf("incorrect original range response: %v", partial.Header())
	}
}

func TestVideoOriginalDownloadRespectsCategoryWelcomeAndSessionAccess(t *testing.T) {
	original := videoFixture(t, "webm")
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Original download guest")
	revoked, identity, _ := guest(t, a, host, "Revoked download guest")
	category := createTestCategory(t, a, host, "Private originals", false)
	r := avatarRequest(t, host, original)
	r.Method = http.MethodPost
	r.URL.Path = "/api/photos"
	r.URL.RawQuery = "categoryId=" + strconv.FormatInt(category.ID, 10)
	photo := finishCategoryUpload(t, a, performMediaUpload(a, r))
	download := photo.URL + "?download=1"
	for _, cookie := range []*http.Cookie{nil, visitor} {
		want := http.StatusNotFound
		if cookie == nil {
			want = http.StatusUnauthorized
		}
		for _, method := range []string{"GET", "HEAD"} {
			for _, path := range []string{download, photo.ThumbnailURL + "&download=1"} {
				r := httptest.NewRequest(method, path, nil)
				if cookie != nil {
					r.AddCookie(cookie)
				}
				r.Header.Set("Range", "bytes=0-31")
				status(t, performMediaUpload(a, r), want)
			}
		}
	}
	assertMediaDownload(t, a, host, photo, original, "video/webm", "webm")
	categoryPath := "/api/admin/media-categories/" + strconv.FormatInt(category.ID, 10)
	status(t, request(t, a, "PUT", categoryPath, map[string]any{"name": category.Name, "isPublic": true}, host), 200)
	assertMediaDownload(t, a, visitor, photo, original, "video/webm", "webm")

	state := changeWelcome(t, a, host, 0, "start")
	for _, method := range []string{"GET", "HEAD"} {
		assertWelcomeError(t, request(t, a, method, download, nil, visitor), 423, "welcome_required")
	}
	changeWelcome(t, a, host, state.Revision, "open")
	status(t, request(t, a, "GET", download, nil, visitor), 200)
	status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
	status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
	for _, cookie := range []*http.Cookie{visitor, revoked} {
		for _, method := range []string{"GET", "HEAD"} {
			status(t, request(t, a, method, download, nil, cookie), 401)
		}
	}
}

func TestVideoOriginalSurvivesRestartRecoveryAndIsDeletedWithThumbnail(t *testing.T) {
	original := videoFixture(t, "mov")
	a := testApp(t)
	host, _ := admin(t, a)
	response := upload(t, a, host, original)
	status(t, response, 201)
	var photo Photo
	if err := json.Unmarshal(response.Body.Bytes(), &photo); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"photos/orphan-original.mov", "uploads/orphan.input", "tmp/orphan.tmp"} {
		if err := os.WriteFile(filepath.Join(a.config.DataDir, path), []byte("unreferenced fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	config, clock := a.config, a.now
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	reopened.now = clock
	if _, err := reopened.mediaStore.Recover(t.Context(), reopened.now(), reopened.mediaFiles.Recover); err != nil {
		t.Fatal(err)
	}
	assertMediaFiles(t, reopened, 2)
	assertMediaDownload(t, reopened, host, photo, original, "video/quicktime", "mov")
	status(t, request(t, reopened, "GET", photo.URL, nil, host), 200)
	status(t, request(t, reopened, "GET", photo.ThumbnailURL, nil, host), 200)
	status(t, request(t, reopened, "DELETE", "/api/photos/"+strconv.FormatInt(photo.ID, 10), nil, host), 204)
	assertMediaFiles(t, reopened, 0)
	status(t, request(t, reopened, "GET", photo.URL+"?download=1", nil, host), 404)
}

func TestVideoOriginalCountsTowardTheAlbumQuota(t *testing.T) {
	original := videoFixture(t, "mp4")
	a := testApp(t)
	host, _ := admin(t, a)
	status(t, upload(t, a, host, original), 201)
	var thumbnail string
	if err := a.db.QueryRow("SELECT thumbnail FROM photos").Scan(&thumbnail); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(a.config.DataDir, "photos", thumbnail))
	if err != nil {
		t.Fatal(err)
	}
	// Leave room for another thumbnail, but not its original video.
	if _, err := a.db.Exec("UPDATE photos SET byte_size=$1", maxStoredPhotoBytes-info.Size()); err != nil {
		t.Fatal(err)
	}
	assertWelcomeError(t, upload(t, a, host, original), 409, "album_full")
	assertMediaFiles(t, a, 2)
}

func TestImageDownloadsPreserveOriginalBytes(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	original := pngBytes(t)
	response := upload(t, a, host, original)
	status(t, response, 201)
	var photo Photo
	if err := json.Unmarshal(response.Body.Bytes(), &photo); err != nil {
		t.Fatal(err)
	}
	image := request(t, a, "GET", photo.URL, nil, host)
	status(t, image, 200)
	if !bytes.Equal(image.Body.Bytes(), original) {
		t.Fatal("image serving changed the original bytes")
	}
	assertMediaDownload(t, a, host, photo, original, photo.MIMEType, "png")
	assertMediaFiles(t, a, 2)
}
