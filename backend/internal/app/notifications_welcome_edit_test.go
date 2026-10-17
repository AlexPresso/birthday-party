package app

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestQueuedNotificationsRespectEditedWelcomeSteps(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		steps    []welcomeStep
		wantSend bool
	}{
		{"all steps removed", []welcomeStep{}, false},
		{"next step removed", []welcomeStep{testWelcomeStep("Current", "")}, false},
		{"next step still available", []welcomeStep{testWelcomeStep("Corrected current", ""), testWelcomeStep("Corrected next", "")}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			a := testApp(t)
			host, visitor, state, _ := queuedTestNotification(t, a)
			state = changeWelcome(t, a, host, state.Revision, "next")
			selectGuestWelcomeStep(t, a, visitor, 1)
			readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{
				"revision": state.Revision,
				"steps":    scenario.steps,
			}, host))

			calls := 0
			a.notificationSender.Client = notificationHTTPFunc(func(*http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
			})
			processed, err := a.notifications.ProcessNext(t.Context())
			if err != nil || processed != scenario.wantSend || (calls == 1) != scenario.wantSend {
				t.Fatalf("delivery after edit: processed=%v calls=%d error=%v", processed, calls, err)
			}
			if notificationOutboxCount(t, a) != 0 {
				t.Fatal("edited welcome left a stale notification in the outbox")
			}
		})
	}
}
