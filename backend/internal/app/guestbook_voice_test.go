package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func voiceRequest(t *testing.T, a *App, cookie *http.Cookie, body string, audio []byte) *httptest.ResponseRecorder {
	t.Helper()
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	if err := writer.WriteField("body", body); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("audio", "voice.ogg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(audio); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/guestbook", &form)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.Header.Set("Origin", a.config.PublicURL)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func TestGuestbookVoiceNotesAreSignedAndServedToGuests(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, g, _ := guest(t, a, host, "Speaker")
	path := filepath.Join(t.TempDir(), "voice.ogg")
	if output, err := exec.Command("ffmpeg", "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2",
		"-c:a", "libopus", "-f", "ogg", path).CombinedOutput(); err != nil {
		t.Fatalf("create recording: %v %s", err, output)
	}
	audio, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	assertWelcomeError(t, voiceRequest(t, a, visitor, "", []byte("not audio")), 400, "invalid_voice_note")
	created := voiceRequest(t, a, visitor, "  Joyeux anniversaire  ", audio)
	status(t, created, 201)
	var entry struct {
		ID        int64 `json:"id"`
		Anonymous bool  `json:"anonymous"`
		Author    *struct {
			ID int64 `json:"id"`
		} `json:"author"`
		Body  string `json:"body"`
		Voice *struct {
			URL        string `json:"url"`
			DurationMS int64  `json:"durationMs"`
			Peaks      []int  `json:"peaks"`
		} `json:"voice"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Anonymous || entry.Author == nil || entry.Author.ID != g.ID || entry.Body != "Joyeux anniversaire" || entry.Voice == nil ||
		entry.Voice.URL != fmt.Sprintf("/api/guestbook/%d/voice", entry.ID) || entry.Voice.DurationMS < 1900 || len(entry.Voice.Peaks) != 48 {
		t.Fatalf("voice entry = %s", created.Body.String())
	}
	listed := request(t, a, "GET", "/api/guestbook", nil, host)
	status(t, listed, 200)
	if !bytes.Contains(listed.Body.Bytes(), []byte(entry.Voice.URL)) {
		t.Fatalf("list lost the voice note: %s", listed.Body.String())
	}

	served := request(t, a, "GET", entry.Voice.URL, nil, host)
	status(t, served, 200)
	etag := served.Header().Get("ETag")
	if served.Header().Get("Content-Type") != "audio/mp4" || served.Header().Get("Cache-Control") != "private, no-cache" || etag == "" ||
		!bytes.Equal(served.Body.Bytes()[4:8], []byte("ftyp")) {
		t.Fatalf("served headers = %v", served.Header())
	}
	r := httptest.NewRequest("GET", entry.Voice.URL, nil)
	r.Header.Set("Range", "bytes=0-9")
	r.AddCookie(visitor)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	status(t, w, http.StatusPartialContent)
	if w.Body.Len() != 10 {
		t.Fatalf("range length = %d", w.Body.Len())
	}
	status(t, request(t, a, "GET", entry.Voice.URL, nil, nil), 401)
	status(t, request(t, a, "GET", fmt.Sprintf("/api/guestbook/%d/voice", entry.ID+1), nil, host), 404)

	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/guestbook/%d", entry.ID), nil, visitor), 204)
	status(t, request(t, a, "GET", entry.Voice.URL, nil, host), 404)
	if countRows(t, a, "SELECT COUNT(*) FROM guestbook_voice_notes") != 0 {
		t.Fatal("the recording outlived its message")
	}
}
