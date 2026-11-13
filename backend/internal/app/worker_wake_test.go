package app

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Idle workers only poll every workerFallbackPoll. Work committed by a request
// must be picked up well before that.
const wakeDeadline = workerFallbackPoll / 2

func TestCommittedWorkWakesIdleWorkers(t *testing.T) {
	a := testApp(t)
	host, _, state, _ := queuedTestNotification(t, a)
	delivered := make(chan struct{}, 4)
	a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
		delivered <- struct{}{}
		return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if err := a.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Startup drains what was already queued; then every worker goes idle.
	select {
	case <-delivered:
	case <-time.After(wakeDeadline):
		t.Fatal("queued notification was not delivered after startup")
	}
	time.Sleep(200 * time.Millisecond)

	changeWelcome(t, a, host, state.Revision, "next")
	select {
	case <-delivered:
	case <-time.After(wakeDeadline):
		t.Fatal("notification waited for the fallback poll")
	}

	started := time.Now()
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	path := "/api/uploads/" + strconv.FormatInt(parseJob(t, response).ID, 10)
	for parseJob(t, request(t, a, "GET", path, nil, host)).Status != "ready" {
		if time.Since(started) > wakeDeadline {
			t.Fatal("upload waited for the fallback poll")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
