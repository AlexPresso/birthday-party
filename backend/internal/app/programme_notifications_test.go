package app

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"birthday-party/backend/internal/programme"
)

func scheduledEvent(t *testing.T, a *App, host *http.Cookie, title, teaser string, startsAt, unlockAt *time.Time) programme.Event {
	t.Helper()
	input := programme.Input{Type: programme.TypeEvent, Title: title, Teaser: teaser}
	if startsAt != nil {
		value := stamp(*startsAt)
		input.StartsAt = &value
	}
	if unlockAt != nil {
		value := stamp(*unlockAt)
		input.UnlockAt = &value
	}
	response := request(t, a, "POST", "/api/admin/programme", input, host)
	status(t, response, 201)
	return eventResponse(t, response)
}

// queuedAnnouncements lists what was queued at the given instant as "kind:title".
func queuedAnnouncements(t *testing.T, a *App, queuedAt time.Time, endpoint string) []string {
	t.Helper()
	rows, err := a.db.Query(`SELECT o.kind||':'||o.title FROM programme_notification_outbox o
 JOIN notification_subscriptions s ON s.id=o.subscription_id
 WHERE o.next_attempt=$1 AND s.endpoint=$2 ORDER BY o.id`, queuedAt, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	queued := []string{}
	for rows.Next() {
		var item string
		if err = rows.Scan(&item); err != nil {
			t.Fatal(err)
		}
		queued = append(queued, item)
	}
	return queued
}

func announce(t *testing.T, a *App, want int) {
	t.Helper()
	if got, err := a.programme.Announce(t.Context(), a.now()); err != nil || got != want {
		t.Fatalf("announced %d moments, want %d (err=%v)", got, want, err)
	}
}

func TestProgrammeNotificationsAnnounceStartsAndRevealsOnce(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	base := a.now()
	now := base
	a.now = func() time.Time { return now }
	at := func(minutes int) *time.Time {
		moment := base.Add(time.Duration(minutes) * time.Minute)
		return &moment
	}
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Subscribed guest")
	guestDevice := testNotificationInput(t)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", guestDevice, visitor), 200)
	hostDevice := testNotificationInput(t)
	hostDevice.Endpoint = "https://push.example.invalid/host"
	status(t, request(t, a, "PUT", "/api/notifications/subscription", hostDevice, host), 200)

	// The switch belongs to the host and is on by default.
	var setting struct{ Enabled bool }
	response := request(t, a, "GET", "/api/admin/programme/notifications", nil, host)
	status(t, response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &setting); err != nil || !setting.Enabled {
		t.Fatalf("default switch=%s err=%v", response.Body.String(), err)
	}
	assertWelcomeError(t, request(t, a, "GET", "/api/admin/programme/notifications", nil, visitor), 403, "admin_required")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/programme/notifications", map[string]any{"enabled": false}, visitor), 403, "admin_required")
	assertWelcomeError(t, request(t, a, "PUT", "/api/admin/programme/notifications", map[string]any{}, host), 400, "invalid_body")

	cake := scheduledEvent(t, a, host, "Le gâteau", "", at(10), nil)
	fireworks := scheduledEvent(t, a, host, "Feu d’artifice", "Rendez-vous dehors", at(20), at(30))
	secret := scheduledEvent(t, a, host, "Secret complet", "", at(20), at(40))
	scheduledEvent(t, a, host, "Dévoilé à l’heure", "Indice", at(50), at(50))
	scheduledEvent(t, a, host, "Hier", "", at(-60), nil)
	draft := customVote(t, a, host, false, "Burgers", "Pizza")
	draftStart := stamp(*at(10))
	status(t, request(t, a, "PUT", "/api/admin/programme/"+strconv.FormatInt(draft.ID, 10), programme.Input{
		Revision: draft.Revision, Title: draft.Title, StartsAt: &draftStart,
		Vote: &programme.VoteInput{Question: "Best costume?", Choices: programme.ChoicesCustom, Labels: []string{"Burgers", "Pizza"}},
	}, host), 200)

	// Nothing is due yet, and an event from before the first pass stays silent.
	announce(t, a, 0)

	now = *at(10)
	announce(t, a, 1)
	for _, endpoint := range []string{guestDevice.Endpoint, hostDevice.Endpoint} {
		if queued := queuedAnnouncements(t, a, now, endpoint); !slices.Equal(queued, []string{"programme_start:Le gâteau"}) {
			t.Fatalf("%s received %q", endpoint, queued)
		}
	}
	// The same moment is never announced twice, even by a second pass.
	announce(t, a, 0)

	// A start while the event is locked shows what guests see: the teaser,
	// or nothing at all.
	now = *at(20)
	announce(t, a, 2)
	if queued := queuedAnnouncements(t, a, now, guestDevice.Endpoint); !slices.Equal(queued, []string{"programme_start:Rendez-vous dehors", "programme_start:"}) {
		t.Fatalf("locked starts queued %q", queued)
	}

	now = *at(30)
	announce(t, a, 1)
	if queued := queuedAnnouncements(t, a, now, guestDevice.Endpoint); !slices.Equal(queued, []string{"programme_unlock:Feu d’artifice"}) {
		t.Fatalf("reveal queued %q", queued)
	}

	// Each device receives one message per event and moment, under its own
	// topic. The cake's start, queued twenty minutes ago, has expired.
	var topics []string
	a.notificationSender.Client = notificationHTTPFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Content-Encoding") != "aes128gcm" {
			t.Fatal("push payload was not encrypted")
		}
		topics = append(topics, r.Header.Get("Topic"))
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	for {
		processed, err := a.notifications.ProcessNext(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if !processed {
			break
		}
	}
	topic := func(event programme.Event) string { return "event-" + strconv.FormatInt(event.ID, 10) }
	want := []string{topic(fireworks), topic(fireworks), topic(secret), topic(secret), topic(fireworks) + "-unlock", topic(fireworks) + "-unlock"}
	if !slices.Equal(topics, want) || slices.Contains(topics, topic(cake)) {
		t.Fatalf("delivered topics=%q, want %q", topics, want)
	}
	if countRows(t, a, "SELECT COUNT(*) FROM programme_notification_outbox") != 0 {
		t.Fatal("delivered or expired announcements stayed queued")
	}

	// A reveal that falls on the start is one notification, with the real name.
	now = *at(50)
	announce(t, a, 2)
	if queued := queuedAnnouncements(t, a, now, guestDevice.Endpoint); !slices.Equal(queued, []string{"programme_unlock:Secret complet", "programme_start:Dévoilé à l’heure"}) {
		t.Fatalf("simultaneous reveal and start queued %q", queued)
	}

	// Turned off, the programme stays silent, and turning it back on does not
	// announce what happened meanwhile.
	status(t, request(t, a, "PUT", "/api/admin/programme/notifications", map[string]any{"enabled": false}, host), 200)
	scheduledEvent(t, a, host, "Pendant la pause", "", at(55), nil)
	now = *at(55)
	announce(t, a, 0)
	status(t, request(t, a, "PUT", "/api/admin/programme/notifications", map[string]any{"enabled": true}, host), 200)
	now = *at(56)
	announce(t, a, 0)

	// Guests held in the welcome sequence cannot open the programme: only the
	// host's device is told. Deleting an event withdraws its queued messages.
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": []welcomeStep{testWelcomeStep("Welcome", "")}}, host))
	changeWelcome(t, a, host, state.Revision, "start")
	last := scheduledEvent(t, a, host, "Après l’accueil", "", at(70), nil)
	now = *at(70)
	announce(t, a, 1)
	if queued := queuedAnnouncements(t, a, now, guestDevice.Endpoint); len(queued) != 0 {
		t.Fatalf("a guest in the welcome sequence was notified: %q", queued)
	}
	if queued := queuedAnnouncements(t, a, now, hostDevice.Endpoint); !slices.Equal(queued, []string{"programme_start:Après l’accueil"}) {
		t.Fatalf("host device queued %q", queued)
	}
	status(t, request(t, a, "DELETE", "/api/admin/programme/"+strconv.FormatInt(last.ID, 10), nil, host), 204)
	if countRows(t, a, "SELECT COUNT(*) FROM programme_notification_outbox WHERE event_id=$1", last.ID) != 0 {
		t.Fatal("a deleted event kept its queued notifications")
	}
}

func TestProgrammeWorkerWaitsForStartsAsWellAsReveals(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	host, _ := admin(t, a)
	start, unlock := a.now().Add(2*time.Hour), a.now().Add(time.Hour)
	scheduledEvent(t, a, host, "Later", "", &start, &unlock)
	sooner := a.now().Add(30 * time.Minute)
	scheduledEvent(t, a, host, "Sooner", "", &sooner, nil)
	if next, err := a.programme.NextMoment(t.Context(), a.now()); err != nil || !next.Equal(sooner) {
		t.Fatalf("next moment=%v err=%v, want the earliest start", next, err)
	}
	if next, err := a.programme.NextMoment(t.Context(), sooner); err != nil || !next.Equal(unlock) {
		t.Fatalf("next moment=%v err=%v, want the reveal", next, err)
	}
	if next, err := a.programme.NextMoment(t.Context(), start); err != nil || !next.IsZero() {
		t.Fatalf("next moment=%v err=%v, want none", next, err)
	}
}
