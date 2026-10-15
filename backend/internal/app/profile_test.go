package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func avatarRequest(t *testing.T, cookie *http.Cookie, files ...[]byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, data := range files {
		part, err := writer.CreateFormFile("file", "../../untrusted.svg")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPut, "/api/profile/avatar", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	return r
}

func uploadAvatar(t *testing.T, a *App, cookie *http.Cookie, files ...[]byte) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, avatarRequest(t, cookie, files...))
	return w
}

func profileGuest(t *testing.T, response *httptest.ResponseRecorder) Guest {
	t.Helper()
	status(t, response, 200)
	var profile struct {
		Guest Guest `json:"guest"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &profile); err != nil {
		t.Fatal(err)
	}
	return profile.Guest
}

func assertAvatarTempEmpty(t *testing.T, a *App) {
	t.Helper()
	files, err := os.ReadDir(filepath.Join(a.config.DataDir, "tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("avatar temporary files retained: count=%d error=%v", len(files), err)
	}
}

func TestProfilePhotoLifecyclePermissionsAndPersistence(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, identity, _ := guest(t, a, host, "Profile owner")
	other, _, _ := guest(t, a, host, "Other guest")
	initial := request(t, a, "GET", "/api/profile", nil, owner)
	if profileGuest(t, initial).AvatarURL != nil || !strings.Contains(initial.Body.String(), `"avatarUrl":null`) || !strings.Contains(initial.Body.String(), `"imageBytes":15728640`) {
		t.Fatalf("unexpected initial profile: %s", initial.Body.String())
	}
	status(t, request(t, a, "GET", "/api/profile", nil, nil), 401)
	status(t, uploadAvatar(t, a, nil, pngBytes(t)), 401)
	status(t, request(t, a, "DELETE", "/api/profile/avatar", nil, nil), 401)
	foreign := avatarRequest(t, owner, pngBytes(t))
	foreign.Header.Set("Origin", "https://other.example")
	blocked := httptest.NewRecorder()
	a.Handler().ServeHTTP(blocked, foreign)
	status(t, blocked, 403)
	first := profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t)))
	if first.ID != identity.ID || first.AvatarURL == nil {
		t.Fatalf("invalid saved identity: %+v", first)
	}
	firstURL := *first.AvatarURL
	status(t, request(t, a, "GET", firstURL, nil, nil), 401)
	imageResponse := request(t, a, "GET", firstURL, nil, other)
	status(t, imageResponse, 200)
	if imageResponse.Header().Get("Content-Type") != "image/jpeg" || imageResponse.Header().Get("Cache-Control") != "private, no-store" || imageResponse.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unsafe avatar headers: %v", imageResponse.Header())
	}
	status(t, request(t, a, "GET", strings.Replace(firstURL, "v=1", "v=999", 1), nil, owner), 404)
	status(t, request(t, a, "GET", strings.Split(firstURL, "?")[0], nil, owner), 404)
	status(t, request(t, a, "PUT", strings.Split(firstURL, "?")[0], nil, other), 405)
	status(t, request(t, a, "DELETE", strings.Split(firstURL, "?")[0], nil, host), 405)
	if profileGuest(t, request(t, a, "DELETE", "/api/profile/avatar", nil, other)).AvatarURL != nil {
		t.Fatal("another guest unexpectedly acquired an avatar")
	}
	status(t, request(t, a, "GET", firstURL, nil, owner), 200)
	second := profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t)))
	if second.AvatarURL == nil || *second.AvatarURL == firstURL {
		t.Fatal("replacement did not change the image URL")
	}
	status(t, request(t, a, "GET", firstURL, nil, owner), 404)
	for _, endpoint := range []string{"/api/session", "/api/profile", "/api/admin/guests"} {
		response := request(t, a, "GET", endpoint, nil, host)
		if endpoint != "/api/admin/guests" {
			response = request(t, a, "GET", endpoint, nil, owner)
		}
		status(t, response, 200)
		if !strings.Contains(response.Body.String(), *second.AvatarURL) {
			t.Fatalf("avatar absent from %s: %s", endpoint, response.Body.String())
		}
	}
	renewed := request(t, a, "POST", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10)+"/invitation", map[string]any{}, host)
	status(t, renewed, 200)
	var issued invitation
	if err := json.Unmarshal(renewed.Body.Bytes(), &issued); err != nil {
		t.Fatal(err)
	}
	accepted := profileGuest(t, request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, issued.InvitationURL)}, nil))
	if accepted.AvatarURL == nil || *accepted.AvatarURL != *second.AvatarURL {
		t.Fatal("replacement invitation lost the profile photo")
	}
	assertAvatarTempEmpty(t, a)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(a.config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	reopened.now = a.now
	status(t, request(t, reopened, "GET", *second.AvatarURL, nil, other), 200)
	removed := profileGuest(t, request(t, reopened, "DELETE", "/api/profile/avatar", nil, owner))
	if removed.AvatarURL != nil {
		t.Fatal("removal returned an avatar URL")
	}
	status(t, request(t, reopened, "GET", *second.AvatarURL, nil, owner), 404)
	third := profileGuest(t, uploadAvatar(t, reopened, owner, pngBytes(t)))
	if third.AvatarURL == nil || *third.AvatarURL == *second.AvatarURL || *third.AvatarURL == firstURL {
		t.Fatal("new upload reused a deleted photo URL")
	}
	status(t, request(t, reopened, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
	status(t, request(t, reopened, "GET", *third.AvatarURL, nil, owner), 401)
	status(t, request(t, reopened, "GET", *third.AvatarURL, nil, other), 200)
}

func TestProfilePhotoAuthorsAndAnonymousPrivacy(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, _, _ := guest(t, a, host, "Profile author")
	other, _, _ := guest(t, a, host, "Profile viewer")
	photoOwner := profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t)))
	for _, anonymous := range []bool{false, true} {
		created := request(t, a, "POST", "/api/guestbook", map[string]any{"body": "A message", "anonymous": anonymous}, owner)
		status(t, created, 201)
		var entry Entry
		if err := json.Unmarshal(created.Body.Bytes(), &entry); err != nil {
			t.Fatal(err)
		}
		if anonymous && (entry.Author != nil || strings.Contains(created.Body.String(), *photoOwner.AvatarURL)) {
			t.Fatal("anonymous creation exposed its author")
		}
		if !anonymous && (entry.Author == nil || entry.Author.AvatarURL == nil || *entry.Author.AvatarURL != *photoOwner.AvatarURL) {
			t.Fatal("named creation omitted its author's avatar")
		}
	}
	status(t, upload(t, a, owner, pngBytes(t)), 201)
	for _, endpoint := range []string{"/api/guestbook", "/api/photos", "/api/uploads"} {
		response := request(t, a, "GET", endpoint, nil, owner)
		status(t, response, 200)
		if !strings.Contains(response.Body.String(), *photoOwner.AvatarURL) {
			t.Fatalf("author avatar missing from %s", endpoint)
		}
	}
	for _, viewer := range []*http.Cookie{host, other, owner} {
		response := request(t, a, "GET", "/api/guestbook", nil, viewer)
		var result struct {
			Items []Entry `json:"items"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 2 || !result.Items[0].Anonymous || result.Items[0].Author != nil {
			t.Fatal("anonymous listing exposed its author")
		}
	}
	status(t, request(t, a, "DELETE", "/api/profile/avatar", nil, owner), 200)
	for _, endpoint := range []string{"/api/guestbook", "/api/photos", "/api/uploads"} {
		response := request(t, a, "GET", endpoint, nil, owner)
		status(t, response, 200)
		if strings.Contains(response.Body.String(), *photoOwner.AvatarURL) || !strings.Contains(response.Body.String(), `"avatarUrl":null`) {
			t.Fatalf("deleted avatar retained in %s", endpoint)
		}
	}
}

func TestProfilePhotoValidationKeepsExistingImage(t *testing.T) {
	a := testApp(t)
	a.config.MaxImageBytes = 1 << 20
	host, _ := admin(t, a)
	initial := profileGuest(t, uploadAvatar(t, a, host, pngBytes(t)))
	oversized := append([]byte(nil), pngBytes(t)...)
	binary.BigEndian.PutUint32(oversized[16:20], 10000)
	binary.BigEndian.PutUint32(oversized[20:24], 10000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	for _, test := range []struct {
		name   string
		files  [][]byte
		status int
		code   string
	}{
		{"missing", nil, 400, "profile_photo_required"},
		{"empty", [][]byte{{}}, 400, "profile_photo_required"},
		{"SVG", [][]byte{[]byte(`<svg onload="alert(1)"/>`)}, 415, "unsupported_profile_photo_type"},
		{"video", [][]byte{[]byte("\x00\x00\x00\x18ftypisom")}, 415, "unsupported_profile_photo_type"},
		{"pixel limit", [][]byte{oversized}, 413, "photo_dimensions_too_large"},
		{"byte limit", [][]byte{bytes.Repeat([]byte{0}, (1<<20)+1)}, 413, "photo_too_large"},
		{"multiple", [][]byte{pngBytes(t), pngBytes(t)}, 400, "single_photo_required"},
		{"truncated", [][]byte{pngBytes(t)[:35]}, 415, "unreadable_photo"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := uploadAvatar(t, a, host, test.files...)
			status(t, response, test.status)
			if !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) {
				t.Fatalf("unexpected validation: %s", response.Body.String())
			}
			status(t, request(t, a, "GET", *initial.AvatarURL, nil, host), 200)
			assertAvatarTempEmpty(t, a)
		})
	}
}

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
			data, err := prepareAvatar(t.Context(), bytes.NewReader(test.data))
			if err != nil {
				t.Fatal(err)
			}
			config, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || format != "jpeg" || config.Width != test.width || config.Height != test.height || len(data) > maxAvatarBytes || bytes.Contains(data, []byte("Exif")) {
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
	if _, err := prepareAvatar(cancelled, bytes.NewReader(large.Bytes())); err != context.Canceled {
		t.Fatalf("cancelled processing error=%v", err)
	}
}

func TestProfilePhotoExtremeAspectRatiosStayBounded(t *testing.T) {
	for _, dimensions := range []image.Point{{X: 10000, Y: 1}, {X: 1, Y: 10000}} {
		var input bytes.Buffer
		if err := png.Encode(&input, image.NewRGBA(image.Rect(0, 0, dimensions.X, dimensions.Y))); err != nil {
			t.Fatal(err)
		}
		data, err := prepareAvatar(t.Context(), bytes.NewReader(input.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width != 256 || config.Height != 256 || len(data) > maxAvatarBytes {
			t.Fatalf("unexpected normalization for %v: config=%+v size=%d error=%v", dimensions, config, len(data), err)
		}
	}
}

func TestProfilePhotoWelcomeAndChangesDuringReception(t *testing.T) {
	for _, action := range []string{"close", "revoke", "logout"} {
		t.Run(action, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			owner, identity, _ := guest(t, a, host, "Uploading profile")
			initial := profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t)))
			r := avatarRequest(t, owner, pngBytes(t))
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch action {
				case "close":
					changeWelcome(t, a, host, 0, "start")
				case "revoke":
					status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, owner), 204)
				}
			}})
			w := httptest.NewRecorder()
			a.Handler().ServeHTTP(w, r)
			want := 401
			if action == "close" {
				want = 423
			}
			status(t, w, want)
			status(t, request(t, a, "GET", *initial.AvatarURL, nil, host), 200)
			assertAvatarTempEmpty(t, a)
			if action == "close" {
				for _, endpoint := range []string{"/api/profile", *initial.AvatarURL} {
					status(t, request(t, a, "GET", endpoint, nil, owner), 423)
				}
				status(t, request(t, a, "DELETE", "/api/profile/avatar", nil, owner), 423)
				status(t, uploadAvatar(t, a, owner, pngBytes(t)), 423)
				status(t, uploadAvatar(t, a, host, pngBytes(t)), 200)
			}
		})
	}
}

func TestProfilePhotoConcurrencyIsBoundedAndReplacementAtomic(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	owner, identity, _ := guest(t, a, host, "Concurrent profile")
	initial := profileGuest(t, uploadAvatar(t, a, owner, pngBytes(t)))
	r := avatarRequest(t, owner, pngBytes(t))
	r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
		response := uploadAvatar(t, a, host, pngBytes(t))
		status(t, response, 429)
		if response.Header().Get("Retry-After") == "" {
			t.Fatal("busy response omitted Retry-After")
		}
	}})
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	status(t, w, 200)
	status(t, request(t, a, "GET", *initial.AvatarURL, nil, owner), 404)
	data, err := prepareAvatar(t.Context(), bytes.NewReader(pngBytes(t)))
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	errors := make(chan error, 12)
	for index := range 12 {
		group.Go(func() {
			var replacement []byte
			if index%2 == 0 {
				replacement = data
			}
			_, err := a.saveAvatar(t.Context(), identity.ID, hashToken(owner.Value), replacement)
			errors <- err
		})
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	var version int64
	var saved []byte
	if err := a.db.QueryRow("SELECT avatar_version,avatar_jpeg FROM guests WHERE id=$1", identity.ID).Scan(&version, &saved); err != nil {
		t.Fatal(err)
	}
	if version != 14 || (saved != nil && !bytes.Equal(saved, data)) {
		t.Fatalf("partial or lost avatar write: version=%d size=%d", version, len(saved))
	}
	assertAvatarTempEmpty(t, a)
}
