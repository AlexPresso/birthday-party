package app

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func setWelcomeRules(t *testing.T, a *App, visitor *http.Cookie, accepted bool) welcomeView {
	t.Helper()
	view := readGuestWelcome(t, a, visitor)
	response := request(t, a, "PUT", "/api/welcome/rules", map[string]any{"revision": view.ProgressRevision, "accepted": accepted}, visitor)
	status(t, response, 200)
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	return view
}

func TestWelcomeRulesHoldGuestsUntilAccepted(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	first, firstIdentity, _ := guest(t, a, host, "Rules reader")
	second, _, _ := guest(t, a, host, "Other reader")
	rules := welcomeWidget{Type: "rules", Rules: []string{"  No phones at the table  ", "Dance at least once"}}
	steps := []welcomeStep{testWelcomeStep("House rules", "", rules), testWelcomeStep("Second", "")}
	state := readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": 0, "steps": steps}, host))
	if saved := state.Steps[0].Widgets[1].Rules; !reflect.DeepEqual(saved, []string{"No phones at the table", "Dance at least once"}) {
		t.Fatalf("rules were not trimmed in order: %q", saved)
	}
	state = changeWelcome(t, a, host, state.Revision, "start")
	// Both guests wait before the first unlock, so they enter the first step.
	readGuestWelcome(t, a, first)
	readGuestWelcome(t, a, second)
	state = changeWelcome(t, a, host, state.Revision, "next")
	state = changeWelcome(t, a, host, state.Revision, "next")

	view := readGuestWelcome(t, a, first)
	if view.Step == nil || view.Step.Position != 1 || view.CanNext || view.RulesAccepted || len(view.Step.Widgets[1].Rules) != 2 {
		t.Fatalf("pending rules did not hold the guest: %+v", view)
	}
	token := view.ProgressRevision
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": token, "action": "next"}, first), 409, "invalid_welcome_transition")
	assertWelcomeError(t, request(t, a, "PUT", "/api/welcome/rules", map[string]any{"revision": token + 1000, "accepted": true}, first), 409, "welcome_conflict")
	assertWelcomeError(t, request(t, a, "PUT", "/api/welcome/rules", map[string]any{"revision": token}, first), 400, "invalid_body")
	assertWelcomeError(t, request(t, a, "PUT", "/api/welcome/rules", map[string]any{"accepted": true}, first), 400, "invalid_body")

	view = setWelcomeRules(t, a, first, true)
	if !view.RulesAccepted || !view.CanNext || view.ProgressRevision != token {
		t.Fatalf("acceptance did not free the guest or changed the token: %+v", view)
	}
	if repeated := setWelcomeRules(t, a, first, true); !repeated.RulesAccepted || repeated.ProgressRevision != token {
		t.Fatalf("repeated acceptance changed the view: %+v", repeated)
	}
	var accepted string
	if err := a.db.QueryRow("SELECT accepted_rules::text FROM guest_welcome_progress WHERE guest_id=$1", firstIdentity.ID).Scan(&accepted); err != nil || accepted != "{1}" {
		t.Fatalf("accepted positions=%q err=%v", accepted, err)
	}
	if other := readGuestWelcome(t, a, second); other.RulesAccepted || other.CanNext {
		t.Fatalf("acceptance leaked to another guest: %+v", other)
	}

	// Editing the rules keeps what the guest already ticked and their widgets.
	steps[0].Widgets[1].Rules = []string{"No phones at the table", "Dance at least once", "What is said here stays here"}
	state = readWelcomeState(t, request(t, a, "PUT", "/api/admin/welcome", map[string]any{"revision": state.Revision, "steps": steps}, host))
	view = readGuestWelcome(t, a, first)
	if !view.RulesAccepted || !view.CanNext || view.ProgressRevision != token || len(view.Step.Widgets[1].Rules) != 3 {
		t.Fatalf("a rules edit withdrew the acceptance: %+v", view)
	}

	view = moveGuestWelcome(t, a, first, "next")
	if view.Step.Position != 2 || view.RulesAccepted {
		t.Fatalf("a step without rules reported an acceptance: %+v", view)
	}
	assertWelcomeError(t, request(t, a, "PUT", "/api/welcome/rules", map[string]any{"revision": view.ProgressRevision, "accepted": true}, first), 409, "invalid_welcome_transition")
	view = moveGuestWelcome(t, a, first, "previous")
	if view.Step.Position != 1 || !view.RulesAccepted || !view.CanNext {
		t.Fatalf("returning to the rules lost the acceptance: %+v", view)
	}
	if view = setWelcomeRules(t, a, first, false); view.RulesAccepted || view.CanNext || !strings.Contains(view.Step.Widgets[1].Rules[2], "stays here") {
		t.Fatalf("unticking did not hold the guest again: %+v", view)
	}

	// Opening the app does not let a guest skip the rules of their step.
	state = changeWelcome(t, a, host, state.Revision, "open")
	view = readGuestWelcome(t, a, first)
	if view.Open || view.CanFinish {
		t.Fatalf("pending rules allowed entering the app: %+v", view)
	}
	assertWelcomeError(t, request(t, a, "POST", "/api/welcome/progress", map[string]any{"revision": view.ProgressRevision, "action": "finish"}, first), 409, "invalid_welcome_transition")
	if view = setWelcomeRules(t, a, first, true); !view.CanFinish {
		t.Fatalf("accepted rules still blocked the entrance: %+v", view)
	}
	if view = moveGuestWelcome(t, a, first, "finish"); !view.Open {
		t.Fatalf("guest did not enter: %+v", view)
	}

	// A new run asks again.
	state = changeWelcome(t, a, host, state.Revision, "start")
	changeWelcome(t, a, host, state.Revision, "next")
	if view = readGuestWelcome(t, a, first); view.Step == nil || view.Step.Position != 1 || view.RulesAccepted || view.CanNext {
		t.Fatalf("a new run kept the previous acceptance: %+v", view)
	}
}
