package app

import (
	"bytes"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// slowBody delivers its content in two halves separated by a pause.
type slowBody struct {
	data  []byte
	pause time.Duration
	sent  int
}

func (b *slowBody) Read(p []byte) (int, error) {
	if b.sent >= len(b.data) {
		return 0, io.EOF
	}
	half := (len(b.data) + 1) / 2
	if b.sent == half {
		time.Sleep(b.pause)
	}
	end := len(b.data)
	if b.sent < half {
		end = half
	}
	n := copy(p, b.data[b.sent:end])
	b.sent += n
	return n, nil
}

func TestMediaRoutesOutliveOrdinaryRequestDeadlines(t *testing.T) {
	const ordinary, pause = 500 * time.Millisecond, 1500 * time.Millisecond
	a := testApp(t)
	setTestUploadLimits(t, a, 64, 64)
	host, _ := admin(t, a)
	server := a.HTTPServer()
	server.ReadTimeout, server.WriteTimeout = ordinary, ordinary
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	base := "http://" + listener.Addr().String()
	send := func(method, path, contentType string, body io.Reader) (*http.Response, error) {
		r, err := http.NewRequest(method, base+path, body)
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Content-Type", contentType)
		r.Header.Set("X-Requested-With", "birthday-party")
		r.AddCookie(host)
		return (&http.Client{Transport: &http.Transport{DisableKeepAlives: true}}).Do(r)
	}

	// An ordinary JSON route keeps the short deadline.
	response, err := send("POST", "/api/guestbook", "application/json", &slowBody{data: []byte(`{"body":"A slow message"}`), pause: pause})
	if err == nil {
		response.Body.Close()
		if response.StatusCode == http.StatusCreated {
			t.Fatal("stalled JSON request was accepted")
		}
	}

	// The same stall during an upload is within its transfer allowance. Padding
	// after the image makes the stored original large enough to fill socket
	// buffers when it is downloaded below.
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, err := writer.CreateFormFile("file", "holiday.png")
	if err != nil {
		t.Fatal(err)
	}
	original := append(pngBytes(t), make([]byte, 48<<20)...)
	if _, err = part.Write(original); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	response, err = send("POST", "/api/photos", writer.FormDataContentType(), &slowBody{data: form.Bytes(), pause: pause})
	if err != nil {
		t.Fatalf("slow upload was cut off: %v", err)
	}
	accepted, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusAccepted {
		t.Fatalf("slow upload: status=%d error=%v body=%s", response.StatusCode, err, accepted)
	}
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(t.Context(), job)
	ready, err := a.uploadByID(t.Context(), job.id, job.guestID)
	if err != nil || ready.Photo == nil {
		t.Fatalf("upload was not published: %+v %v", ready, err)
	}

	// A client that stops reading for a while still receives the whole file.
	response, err = send("GET", ready.Photo.URL, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	time.Sleep(pause)
	received, err := io.Copy(io.Discard, response.Body)
	if err != nil || received != int64(len(original)) {
		t.Fatalf("slow download: received %d of %d bytes: %v", received, len(original), err)
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "image/png") {
		t.Fatalf("content type %q", response.Header.Get("Content-Type"))
	}
}
