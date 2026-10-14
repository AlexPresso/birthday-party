package app

import (
	"bytes"
	"context"
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
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func testApp(t *testing.T) *App {
	t.Helper()
	a, err := Open(Config{PublicURL: "http://localhost:3000", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	a.now = func() time.Time { return time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { a.Close() })
	return a
}

func request(t *testing.T, a *App, method, path string, value any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if value != nil {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(data)
	}
	r := httptest.NewRequest(method, path, body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Requested-With", "birthday-party")
	r.Header.Set("Origin", a.config.PublicURL)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func status(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status=%d want=%d body=%s", response.Code, want, response.Body.String())
	}
}

func tokenFromURL(t *testing.T, link string) string {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	values, err := url.ParseQuery(u.Fragment)
	if err != nil {
		t.Fatal(err)
	}
	return values.Get("token")
}

func admin(t *testing.T, a *App) (*http.Cookie, Guest) {
	t.Helper()
	link, err := a.InviteAdmin(context.Background(), "Camille")
	if err != nil {
		t.Fatal(err)
	}
	r := request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, link)}, nil)
	status(t, r, 200)
	var result struct {
		Guest Guest `json:"guest"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return r.Result().Cookies()[0], result.Guest
}

func guest(t *testing.T, a *App, host *http.Cookie, name string) (*http.Cookie, Guest, string) {
	t.Helper()
	r := request(t, a, "POST", "/api/admin/guests", map[string]string{"name": name}, host)
	status(t, r, 201)
	var result struct {
		Guest         Guest  `json:"guest"`
		InvitationURL string `json:"invitationUrl"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	token := tokenFromURL(t, result.InvitationURL)
	r = request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil)
	status(t, r, 200)
	return r.Result().Cookies()[0], result.Guest, token
}

func TestInvitationLifecycle(t *testing.T) {
	a := testApp(t)
	link, err := a.InviteAdmin(context.Background(), "Camille")
	if err != nil {
		t.Fatal(err)
	}
	token := tokenFromURL(t, link)
	status(t, request(t, a, "GET", "/api/invitations/accept?token="+token, nil, nil), 405)
	for range 2 {
		status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": token}, nil), 200)
	}
	accepted := request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil)
	status(t, accepted, 200)
	cookie := accepted.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
	status(t, request(t, a, "GET", "/api/session", nil, cookie), 200)
	status(t, request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil), 401)
	var stored string
	if err := a.db.QueryRow("SELECT token_hash FROM sessions").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == cookie.Value || stored != hashToken(cookie.Value) {
		t.Fatal("session token must only be stored hashed")
	}
	status(t, request(t, a, "POST", "/api/logout", map[string]any{}, cookie), 204)
	status(t, request(t, a, "GET", "/api/session", nil, cookie), 401)
}

func TestInvitationExpiresAndSessionExpires(t *testing.T) {
	t.Run("invitation", func(t *testing.T) {
		a := testApp(t)
		link, err := a.InviteAdmin(context.Background(), "Camille")
		if err != nil {
			t.Fatal(err)
		}
		expires := a.now().Add(invitationTTL)
		a.now = func() time.Time { return expires }
		status(t, request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, link)}, nil), 401)
	})
	t.Run("session", func(t *testing.T) {
		a := testApp(t)
		cookie, _ := admin(t, a)
		expires := a.now().Add(sessionTTL)
		a.now = func() time.Time { return expires }
		status(t, request(t, a, "GET", "/api/session", nil, cookie), 401)
	})
}

func TestConcurrentInvitationOnlyAcceptedOnce(t *testing.T) {
	a := testApp(t)
	link, err := a.InviteAdmin(context.Background(), "Camille")
	if err != nil {
		t.Fatal(err)
	}
	token := tokenFromURL(t, link)
	var group sync.WaitGroup
	results := make(chan int, 2)
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			results <- request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil).Code
		}()
	}
	group.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[200] != 1 || counts[401] != 1 {
		t.Fatalf("expected one acceptance, got %v", counts)
	}
}

func TestCSRFAndAuthorization(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Léa")
	status(t, request(t, a, "GET", "/api/party", nil, nil), 401)
	status(t, request(t, a, "GET", "/api/admin/guests", nil, visitor), 403)
	for _, origin := range []string{"https://evil.example", "null", "http://localhost:3000.evil.example"} {
		r := httptest.NewRequest("POST", "/api/guestbook", strings.NewReader(`{"body":"hello"}`))
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Requested-With", "birthday-party")
		r.AddCookie(visitor)
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		status(t, w, 403)
	}
	r := httptest.NewRequest("POST", "/api/guestbook", strings.NewReader(`{"body":"hello"}`))
	r.Header.Set("Origin", a.config.PublicURL)
	r.AddCookie(visitor)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	status(t, w, 403)
	status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": "  Bon anniversaire !  "}, visitor), 201)
}

func TestRenewAndRevokePreserveIdentity(t *testing.T) {
	a := testApp(t)
	host, hostGuest := admin(t, a)
	visitor, identity, _ := guest(t, a, host, "Léa")
	status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": "Souvenir"}, visitor), 201)
	base := "/api/admin/guests/" + strconv.FormatInt(identity.ID, 10)
	r := request(t, a, "POST", base+"/invitation", map[string]any{}, host)
	status(t, r, 200)
	var renewed invitation
	if err := json.Unmarshal(r.Body.Bytes(), &renewed); err != nil {
		t.Fatal(err)
	}
	r = request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, renewed.InvitationURL)}, nil)
	status(t, r, 200)
	var accepted struct {
		Guest Guest `json:"guest"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.Guest.ID != identity.ID {
		t.Fatal("renewal changed identity")
	}
	newCookie := r.Result().Cookies()[0]
	status(t, request(t, a, "DELETE", base, nil, host), 204)
	status(t, request(t, a, "GET", "/api/session", nil, visitor), 401)
	status(t, request(t, a, "GET", "/api/session", nil, newCookie), 401)
	r = request(t, a, "GET", "/api/guestbook", nil, host)
	status(t, r, 200)
	if !strings.Contains(r.Body.String(), "Léa") || !strings.Contains(r.Body.String(), "Souvenir") {
		t.Fatal("revocation lost attribution")
	}
	status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(hostGuest.ID, 10), nil, host), 409)
	r = request(t, a, "POST", base+"/invitation", map[string]any{}, host)
	status(t, r, 200)
	if err := json.Unmarshal(r.Body.Bytes(), &renewed); err != nil {
		t.Fatal(err)
	}
	r = request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": tokenFromURL(t, renewed.InvitationURL)}, nil)
	status(t, r, 200)
	if err := json.Unmarshal(r.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	if !accepted.Guest.Active || accepted.Guest.ID != identity.ID {
		t.Fatal("reactivation must preserve identity")
	}
	status(t, request(t, a, "GET", "/api/session", nil, visitor), 401)
}

func TestUnlockBoundaryAndPrivateContent(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Léa")
	unlock := a.now().Add(time.Hour)
	input := eventInput{Title: "Concert secret", Description: "Le groupe et le lieu secrets", Teaser: "Garde ta soirée libre", UnlockAt: ptr(stamp(unlock))}
	status(t, request(t, a, "POST", "/api/admin/programme", input, host), 201)
	for _, test := range []struct {
		name   string
		at     time.Time
		locked bool
	}{{"before", unlock.Add(-time.Nanosecond), true}, {"at", unlock, false}, {"after", unlock.Add(time.Nanosecond), false}} {
		t.Run(test.name, func(t *testing.T) {
			a.now = func() time.Time { return test.at }
			r := request(t, a, "GET", "/api/programme", nil, visitor)
			status(t, r, 200)
			var result struct {
				Items []Event `json:"items"`
			}
			if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Items) != 1 || result.Items[0].Locked != test.locked {
				t.Fatal(r.Body.String())
			}
			if test.locked && (strings.Contains(r.Body.String(), "Concert secret") || strings.Contains(r.Body.String(), "Le groupe")) {
				t.Fatal("private content leaked")
			}
			if test.locked && result.Items[0].Title != input.Teaser {
				t.Fatal("missing public teaser")
			}
			if !test.locked && result.Items[0].Title != input.Title {
				t.Fatal("available event still hidden")
			}
		})
	}
	a.now = func() time.Time { return unlock.Add(-time.Minute) }
	r := request(t, a, "GET", "/api/admin/programme", nil, host)
	status(t, r, 200)
	if !strings.Contains(r.Body.String(), input.Title) {
		t.Fatal("host cannot manage private event")
	}
}

func ptr(value string) *string { return &value }

func TestGuestbookPaginationOwnershipAndValidation(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	one, _, _ := guest(t, a, host, "Léa")
	two, _, _ := guest(t, a, host, "Alex")
	for _, body := range []string{"   ", strings.Repeat("é", 2001)} {
		status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": body}, one), 400)
	}
	for _, body := range []string{"one", "two", "three"} {
		status(t, request(t, a, "POST", "/api/guestbook", map[string]string{"body": body}, one), 201)
	}
	r := request(t, a, "GET", "/api/guestbook?limit=2", nil, two)
	status(t, r, 200)
	var page struct {
		Items []Entry `json:"items"`
		Next  *string `json:"nextCursor"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].Body != "three" || page.Next == nil {
		t.Fatal(r.Body.String())
	}
	r = request(t, a, "GET", "/api/guestbook?limit=2&before="+*page.Next, nil, two)
	status(t, r, 200)
	if err := json.Unmarshal(r.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Body != "one" || page.Next != nil {
		t.Fatal(r.Body.String())
	}
	status(t, request(t, a, "DELETE", "/api/guestbook/1", nil, two), 403)
	status(t, request(t, a, "DELETE", "/api/guestbook/1", nil, one), 204)
	status(t, request(t, a, "DELETE", "/api/guestbook/2", nil, host), 204)
}

func upload(t *testing.T, a *App, cookie *http.Cookie, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "../../untrusted-name.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/photos", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.Header.Set("Origin", a.config.PublicURL)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 12, 8))
	img.Set(1, 1, color.RGBA{R: 255, A: 255})
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestPhotoProtectionValidationOwnershipAndPersistence(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	one, _, _ := guest(t, a, host, "Léa")
	two, _, _ := guest(t, a, host, "Alex")
	data := pngBytes(t)
	status(t, upload(t, a, nil, data), 401)
	status(t, upload(t, a, one, []byte("<svg onload='alert(1)'></svg>")), 415)
	status(t, upload(t, a, one, bytes.Repeat([]byte{0}, int(defaultMaxImageBytes)+1)), 413)
	oversized := append([]byte(nil), data...)
	binary.BigEndian.PutUint32(oversized[16:20], 10000)
	binary.BigEndian.PutUint32(oversized[20:24], 10000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	status(t, upload(t, a, one, oversized), 413)
	entries, err := os.ReadDir(filepath.Join(a.config.DataDir, "tmp"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed upload temp files retained: %v %v", entries, err)
	}
	r := upload(t, a, one, data)
	status(t, r, 201)
	var photo Photo
	if err := json.Unmarshal(r.Body.Bytes(), &photo); err != nil {
		t.Fatal(err)
	}
	if photo.Width != 12 || photo.Height != 8 {
		t.Fatalf("invalid photo: %+v", photo)
	}
	status(t, request(t, a, "GET", photo.URL, nil, nil), 401)
	status(t, request(t, a, "GET", photo.ThumbnailURL, nil, nil), 401)
	status(t, request(t, a, "GET", photo.URL, nil, two), 200)
	thumb := request(t, a, "GET", photo.ThumbnailURL, nil, two)
	status(t, thumb, 200)
	if thumb.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatal("wrong thumbnail type")
	}
	status(t, request(t, a, "DELETE", "/api/photos/"+strconv.FormatInt(photo.ID, 10), nil, two), 403)
	config := a.config
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.now = a.now
	status(t, request(t, reopened, "GET", photo.URL, nil, one), 200)
	status(t, request(t, reopened, "DELETE", "/api/photos/"+strconv.FormatInt(photo.ID, 10), nil, host), 204)
	status(t, request(t, reopened, "GET", photo.URL, nil, one), 404)
	files, err := os.ReadDir(filepath.Join(config.DataDir, "photos"))
	if err != nil || len(files) != 0 {
		t.Fatalf("deleted photo files retained: %v %v", files, err)
	}
}

func TestPartyTimezoneAndUTC(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	for _, zone := range []string{"Local", "", "Europe/Unknown"} {
		status(t, request(t, a, "PATCH", "/api/admin/party", Party{Title: "La fête", Timezone: zone}, host), 400)
	}
	r := request(t, a, "PATCH", "/api/admin/party", Party{Title: "La fête", Timezone: "Europe/Zurich", Date: ptr("2026-10-30T19:00:00+01:00"), Location: "À définir"}, host)
	status(t, r, 200)
	if !strings.Contains(r.Body.String(), "2026-10-30T18:00:00Z") {
		t.Fatal("date was not normalized to UTC")
	}
}

func TestInvitationRateLimit(t *testing.T) {
	a := testApp(t)
	for range 120 {
		status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": "invalid"}, nil), 401)
	}
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": "invalid"}, nil), 429)
	next := a.now().Add(time.Minute)
	a.now = func() time.Time { return next }
	status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": "invalid"}, nil), 401)
}

func TestJPEGPhoneOrientation(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 12, 8)), nil); err != nil {
		t.Fatal(err)
	}
	// Minimal JPEG APP1 Exif segment: little-endian TIFF IFD, orientation=6.
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	data := append([]byte{}, encoded.Bytes()[:2]...)
	data = append(data, 0xff, 0xe1, byte((len(exif)+2)>>8), byte(len(exif)+2))
	data = append(data, exif...)
	data = append(data, encoded.Bytes()[2:]...)
	r := upload(t, a, host, data)
	status(t, r, 201)
	var photo Photo
	if err := json.Unmarshal(r.Body.Bytes(), &photo); err != nil {
		t.Fatal(err)
	}
	if photo.Width != 8 || photo.Height != 12 {
		t.Fatalf("EXIF rotation was ignored: %+v", photo)
	}
	thumb := request(t, a, "GET", photo.ThumbnailURL, nil, host)
	status(t, thumb, 200)
	config, _, err := image.DecodeConfig(bytes.NewReader(thumb.Body.Bytes()))
	if err != nil || config.Width != 8 || config.Height != 12 {
		t.Fatalf("thumbnail orientation: %+v, %v", config, err)
	}
}

func TestRenewalInvalidatesPendingLinkAndSessionsAreBounded(t *testing.T) {
	a := testApp(t)
	host, hostGuest := admin(t, a)
	path := "/api/admin/guests/" + strconv.FormatInt(hostGuest.ID, 10) + "/invitation"
	var pending string
	for range 2 {
		r := request(t, a, "POST", path, map[string]any{}, host)
		status(t, r, 200)
		var result invitation
		if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if pending != "" {
			status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": pending}, nil), 401)
		}
		pending = tokenFromURL(t, result.InvitationURL)
		status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": pending}, nil), 200)
	}
	var previous string
	for range 7 {
		r := request(t, a, "POST", path, map[string]any{}, host)
		status(t, r, 200)
		var result invitation
		if err := json.Unmarshal(r.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		token := tokenFromURL(t, result.InvitationURL)
		if previous != "" {
			status(t, request(t, a, "POST", "/api/invitations/preview", map[string]string{"token": previous}, nil), 401)
		}
		accepted := request(t, a, "POST", "/api/invitations/accept", map[string]string{"token": token}, nil)
		status(t, accepted, 200)
		host = accepted.Result().Cookies()[0]
		previous = token
	}
	var sessions int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE guest_id=?", hostGuest.ID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 5 {
		t.Fatalf("session count=%d want5", sessions)
	}
}

func TestHTTPSCookieAndConfiguration(t *testing.T) {
	a := testApp(t)
	a.config.CookieSecure = true
	host, _ := admin(t, a)
	if !host.Secure {
		t.Fatal("HTTPS cookie is not Secure")
	}
	t.Setenv("PUBLIC_URL", "https://birthday.example")
	t.Setenv("COOKIE_SECURE", "false")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("insecure HTTPS cookie configuration accepted")
	}
	t.Setenv("COOKIE_SECURE", "true")
	if _, err := ConfigFromEnv(); err != nil {
		t.Fatal(err)
	}
}
