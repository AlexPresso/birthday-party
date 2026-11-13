package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func solidPNG(t *testing.T, shade uint8) []byte {
	t.Helper()
	picture := image.NewGray(image.Rect(0, 0, 32, 32))
	for i := range picture.Pix {
		picture.Pix[i] = shade
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

// conditionalGet requests a media URL with optional request headers.
func conditionalGet(a *App, cookie *http.Cookie, url string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, url, nil)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	for name, value := range headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func assertRevalidated(t *testing.T, a *App, cookie *http.Cookie, url string) (etag string) {
	t.Helper()
	full := conditionalGet(a, cookie, url, nil)
	status(t, full, http.StatusOK)
	etag = full.Header().Get("ETag")
	if etag == "" || full.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("%s: ETag=%q Cache-Control=%q", url, etag, full.Header().Get("Cache-Control"))
	}
	unchanged := conditionalGet(a, cookie, url, map[string]string{"If-None-Match": etag})
	status(t, unchanged, http.StatusNotModified)
	if unchanged.Body.Len() != 0 || unchanged.Header().Get("ETag") != etag || unchanged.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("%s: invalid 304: %d bytes, headers %v", url, unchanged.Body.Len(), unchanged.Header())
	}
	status(t, conditionalGet(a, cookie, url, map[string]string{"If-None-Match": `"another-version"`}), http.StatusOK)
	return etag
}

func TestCachedMediaIsRevalidatedOnlyAfterAuthorization(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, identity, _ := guest(t, a, host, "Media owner")
	viewer, _, _ := guest(t, a, host, "Media viewer")
	category := createTestCategory(t, a, host, "Shared", true)
	r := avatarRequest(t, owner, pngBytes(t))
	r.Method = http.MethodPost
	r.URL.Path = "/api/photos"
	r.URL.RawQuery = "categoryId=" + strconv.FormatInt(category.ID, 10)
	photo := finishCategoryUpload(t, a, performMediaUpload(a, r))
	avatar := *profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t))).AvatarURL

	validators := map[string]string{}
	for _, url := range []string{photo.URL, photo.ThumbnailURL, avatar} {
		validators[url] = assertRevalidated(t, a, viewer, url)
	}
	if validators[photo.URL] == validators[photo.ThumbnailURL] {
		t.Fatal("original and thumbnail share a validator")
	}
	if download := conditionalGet(a, viewer, photo.URL+"?download=1", nil); download.Header().Get("ETag") != validators[photo.URL] {
		t.Fatal("download of the same file changed its validator")
	}
	modified := conditionalGet(a, viewer, photo.URL, nil).Header().Get("Last-Modified")
	if modified == "" {
		t.Fatal("stored media has no Last-Modified")
	}
	status(t, conditionalGet(a, viewer, photo.URL, map[string]string{"If-Modified-Since": modified}), http.StatusNotModified)

	// JSON responses stay uncacheable.
	if list := conditionalGet(a, viewer, "/api/photos?categoryId="+strconv.FormatInt(category.ID, 10), nil); list.Header().Get("Cache-Control") != "no-store" || list.Header().Get("ETag") != "" {
		t.Fatalf("JSON response became cacheable: %v", list.Header())
	}

	// A matching validator never bypasses authorization or reveals existence.
	conditional := func(cookie *http.Cookie, url string) *httptest.ResponseRecorder {
		return conditionalGet(a, cookie, url, map[string]string{"If-None-Match": validators[url]})
	}
	assertDenied := func(response *httptest.ResponseRecorder, want int) {
		t.Helper()
		status(t, response, want)
		if response.Header().Get("ETag") != "" || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("denied response is cacheable: %v", response.Header())
		}
	}
	for url := range validators {
		assertDenied(conditional(nil, url), http.StatusUnauthorized)
	}
	status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": false}, host), 200)
	assertDenied(conditional(viewer, photo.URL), http.StatusNotFound)
	assertDenied(conditional(viewer, photo.ThumbnailURL), http.StatusNotFound)
	status(t, conditional(host, photo.URL), http.StatusNotModified)

	state := changeWelcome(t, a, host, 0, "start")
	assertDenied(conditional(viewer, avatar), http.StatusLocked)
	changeWelcome(t, a, host, state.Revision, "open")
	status(t, conditional(viewer, avatar), http.StatusNotModified)

	status(t, request(t, a, "POST", "/api/logout", nil, viewer), 204)
	assertDenied(conditional(viewer, avatar), http.StatusUnauthorized)
	status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
	assertDenied(conditional(owner, avatar), http.StatusUnauthorized)

	// A replaced avatar gets a new URL and a new validator.
	updated := *profileGuest(t, uploadAvatar(t, a, host, solidPNG(t, 40))).AvatarURL
	first := assertRevalidated(t, a, host, updated)
	second := *profileGuest(t, uploadAvatar(t, a, host, solidPNG(t, 200))).AvatarURL
	if assertRevalidated(t, a, host, second) == first {
		t.Fatal("different avatar content kept its validator")
	}
}

func TestVideoRangesWorkWithValidators(t *testing.T) {
	data := videoFixture(t, "mp4")
	a := testApp(t)
	host, _ := admin(t, a)
	r := avatarRequest(t, host, data)
	r.Method = http.MethodPost
	r.URL.Path = "/api/photos"
	response := performMediaUpload(a, r)
	status(t, response, 202)
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(t.Context(), job)
	var ready UploadJob
	if err := json.Unmarshal(request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.id, 10), nil, host).Body.Bytes(), &ready); err != nil || ready.Photo == nil {
		t.Fatalf("video was not published: %+v %v", ready, err)
	}
	url := ready.Photo.URL
	etag := conditionalGet(a, host, url, nil).Header().Get("ETag")
	if etag == "" {
		t.Fatal("video has no validator")
	}
	partial := conditionalGet(a, host, url, map[string]string{"Range": "bytes=4-35"})
	status(t, partial, http.StatusPartialContent)
	if !bytes.Equal(partial.Body.Bytes(), data[4:36]) || partial.Header().Get("ETag") != etag {
		t.Fatal("range response returned other bytes or lost the validator")
	}
	// A resumed download continues only while the stored file is unchanged.
	resumed := conditionalGet(a, host, url, map[string]string{"Range": "bytes=4-35", "If-Range": etag})
	status(t, resumed, http.StatusPartialContent)
	restarted := conditionalGet(a, host, url, map[string]string{"Range": "bytes=4-35", "If-Range": `"another-version"`})
	status(t, restarted, http.StatusOK)
	if restarted.Body.Len() != len(data) {
		t.Fatalf("stale range returned %d of %d bytes", restarted.Body.Len(), len(data))
	}
}
