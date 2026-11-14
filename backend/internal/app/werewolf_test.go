package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

// werewolfViewer is someone looking at a game: who they are and their session.
type werewolfViewer struct {
	name   string
	id     int64
	cookie *http.Cookie
}

func werewolfGuest(t *testing.T, a *App, host *http.Cookie, name string) werewolfViewer {
	t.Helper()
	cookie, guest, _ := guest(t, a, host, name)
	return werewolfViewer{name: name, id: guest.ID, cookie: cookie}
}

func werewolfEvent(t *testing.T, a *App, host *http.Cookie, gameMasterID *int64) programme.Event {
	t.Helper()
	input := programme.Input{Type: programme.TypeWerewolf, Title: "Night falls", Werewolf: &programme.WerewolfInput{GameMasterID: gameMasterID}}
	response := request(t, a, "POST", "/api/admin/programme", input, host)
	status(t, response, 201)
	return eventResponse(t, response)
}

func werewolfPath(eventID int64, suffix string) string {
	return fmt.Sprintf("/api/programme/%d/werewolf%s", eventID, suffix)
}

// werewolfDo sends a request about a game and returns the raw response.
func werewolfDo(t *testing.T, a *App, viewer werewolfViewer, method string, eventID int64, suffix string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, a, method, werewolfPath(eventID, suffix), body, viewer.cookie)
}

// werewolfGame runs a request that must succeed and decodes the game its
// viewer received.
func werewolfGame(t *testing.T, a *App, viewer werewolfViewer, method string, eventID int64, suffix string, body any) programme.Werewolf {
	t.Helper()
	response := werewolfDo(t, a, viewer, method, eventID, suffix, body)
	status(t, response, 200)
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("game response may be cached: %q", response.Header().Get("Cache-Control"))
	}
	var game programme.Werewolf
	if err := json.Unmarshal(response.Body.Bytes(), &game); err != nil {
		t.Fatal(err)
	}
	return game
}

func werewolfRead(t *testing.T, a *App, viewer werewolfViewer, eventID int64) programme.Werewolf {
	t.Helper()
	return werewolfGame(t, a, viewer, "GET", eventID, "", nil)
}

// werewolfBody is the game exactly as it reaches one viewer.
func werewolfBody(t *testing.T, a *App, viewer werewolfViewer, eventID int64) string {
	t.Helper()
	response := werewolfDo(t, a, viewer, "GET", eventID, "", nil)
	status(t, response, 200)
	return response.Body.String()
}

func werewolfState(t *testing.T, a *App, master werewolfViewer, eventID int64, action programme.WerewolfAction) programme.Werewolf {
	t.Helper()
	revision := werewolfRead(t, a, master, eventID).Revision
	return werewolfGame(t, a, master, "POST", eventID, "/state", map[string]any{"revision": revision, "action": action})
}

func werewolfLife(t *testing.T, a *App, master werewolfViewer, eventID, guestID int64, alive bool) programme.Werewolf {
	t.Helper()
	return werewolfGame(t, a, master, "PUT", eventID, fmt.Sprintf("/players/%d", guestID), map[string]any{"alive": alive})
}

func werewolfVariants(t *testing.T, a *App, master werewolfViewer, eventID int64, hideRolesOfDead, ghostMessages bool) programme.Werewolf {
	t.Helper()
	return werewolfGame(t, a, master, "PUT", eventID, "/variants", map[string]any{"hideRolesOfDead": hideRolesOfDead, "ghostMessages": ghostMessages})
}

func werewolfPhase(t *testing.T, a *App, master werewolfViewer, eventID int64, phase programme.WerewolfPhase) programme.Werewolf {
	t.Helper()
	return werewolfGame(t, a, master, "PUT", eventID, "/phase", map[string]any{"phase": phase})
}

// roleLabel names a card by its built-in key or its custom name.
func roleLabel(card *programme.RoleCard) string {
	switch {
	case card == nil:
		return ""
	case card.Key != nil:
		return *card.Key
	}
	return *card.Name
}

func werewolfPlayer(t *testing.T, game programme.Werewolf, guestID int64) programme.WerewolfPlayer {
	t.Helper()
	for _, player := range game.Players {
		if player.ID == guestID {
			return player
		}
	}
	t.Fatalf("guest %d is not a player of %+v", guestID, game.Players)
	return programme.WerewolfPlayer{}
}

// runningWerewolf creates a game led by a guest, seats the named players and
// starts it with one werewolf among villagers.
func runningWerewolf(t *testing.T, a *App, host *http.Cookie, names ...string) (programme.Event, werewolfViewer, []werewolfViewer) {
	t.Helper()
	master := werewolfGuest(t, a, host, "Morgan")
	event := werewolfEvent(t, a, host, &master.id)
	players := make([]werewolfViewer, len(names))
	for i, name := range names {
		players[i] = werewolfGuest(t, a, host, name)
		werewolfGame(t, a, players[i], "POST", event.ID, "/players", map[string]any{})
	}
	game := werewolfRead(t, a, master, event.ID)
	roles := []map[string]any{
		{"id": game.Roles[0].ID, "key": programme.RoleWerewolf, "name": nil, "description": nil, "count": 1},
		{"id": game.Roles[1].ID, "key": programme.RoleVillager, "name": nil, "description": nil, "count": len(names) - 1},
	}
	werewolfGame(t, a, master, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision, "roles": roles})
	if started := werewolfState(t, a, master, event.ID, programme.WerewolfStart); started.Status != programme.WerewolfRunning {
		t.Fatalf("game did not start: %+v", started)
	}
	return event, master, players
}

func TestWerewolfDealsSecretRolesAndRevealsThemAtTheEnd(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	hostCookie, hostGuest := admin(t, a)
	host := werewolfViewer{name: "host", id: hostGuest.ID, cookie: hostCookie}
	master := werewolfGuest(t, a, hostCookie, "Morgan")
	ada, ben := werewolfGuest(t, a, hostCookie, "Ada"), werewolfGuest(t, a, hostCookie, "Ben")
	cleo, dan := werewolfGuest(t, a, hostCookie, "Cleo"), werewolfGuest(t, a, hostCookie, "Dan")
	outsider := werewolfGuest(t, a, hostCookie, "Eve")
	players := []werewolfViewer{ada, ben, cleo, dan}
	everyone := []werewolfViewer{master, ada, ben, cleo, dan, outsider, host}

	status(t, request(t, a, "POST", "/api/admin/programme", programme.Input{Type: programme.TypeWerewolf, Title: "Forbidden"}, master.cookie), 403)
	event := werewolfEvent(t, a, hostCookie, &master.id)
	if summary := event.Werewolf; event.Type != programme.TypeWerewolf || summary == nil || summary.Status != programme.WerewolfLobby ||
		summary.GameMaster == nil || summary.GameMaster.ID != master.id || summary.GameMaster.Name != "Morgan" || summary.Players != 0 {
		t.Fatalf("created event=%+v", event)
	}

	// A new game has every built-in role, with one werewolf. Only the game
	// master receives the list.
	game := werewolfRead(t, a, master, event.ID)
	if !game.IsGameMaster || game.Joined || game.Status != programme.WerewolfLobby || game.Phase != programme.PhaseDay ||
		game.Players == nil || len(game.Players) != 0 || game.Messages == nil || len(game.Roles) != 7 {
		t.Fatalf("new game for its master=%+v", game)
	}
	for i, key := range []string{"werewolf", "villager", "seer", "witch", "hunter", "cupid", "guard"} {
		role, count := game.Roles[i], 0
		if key == programme.RoleWerewolf {
			count = 1
		}
		if roleLabel(&role.RoleCard) != key || role.Name != nil || role.Description != nil || role.Count != count {
			t.Fatalf("built-in role %d=%+v", i, role)
		}
	}
	for _, viewer := range []werewolfViewer{outsider, host} {
		lobby := werewolfRead(t, a, viewer, event.ID)
		if lobby.IsGameMaster || lobby.Roles != nil || lobby.Messages != nil || lobby.GameMaster == nil || lobby.GameMaster.ID != master.id {
			t.Fatalf("lobby for %s=%+v", viewer.name, lobby)
		}
	}

	// Guests join and leave; the game master does not play, the host may.
	for _, player := range players {
		werewolfGame(t, a, player, "POST", event.ID, "/players", map[string]any{})
	}
	game = werewolfGame(t, a, ada, "POST", event.ID, "/players", map[string]any{})
	if !game.Joined || len(game.Players) != 4 || game.Players[0].ID != ada.id || game.Players[3].ID != dan.id || game.Players[0].Name != "Ada" {
		t.Fatalf("players after joining twice=%+v", game.Players)
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "POST", event.ID, "/players", map[string]any{}), 409, "activity_conflict")
	if joined := werewolfGame(t, a, host, "POST", event.ID, "/players", map[string]any{}); !joined.Joined || len(joined.Players) != 5 || joined.Roles != nil {
		t.Fatalf("host as a player=%+v", joined)
	}
	for range 2 {
		if left := werewolfGame(t, a, host, "DELETE", event.ID, "/players/me", nil); left.Joined || len(left.Players) != 4 {
			t.Fatalf("host after leaving=%+v", left)
		}
	}
	werewolfGame(t, a, outsider, "POST", event.ID, "/players", map[string]any{})
	removal := fmt.Sprintf("/players/%d", outsider.id)
	for range 2 {
		if removed := werewolfGame(t, a, master, "DELETE", event.ID, removal, nil); len(removed.Players) != 4 {
			t.Fatalf("players after removal=%+v", removed.Players)
		}
	}
	if summary := programmeEvents(t, a, outsider.cookie, false)[0].Werewolf; summary == nil || summary.Players != 4 || summary.Status != programme.WerewolfLobby {
		t.Fatalf("programme summary=%+v", summary)
	}

	// Game master commands are refused to everyone else, the party's host
	// included, and change nothing.
	villager := []map[string]any{{"key": "villager", "name": nil, "description": nil, "count": 4}}
	refuseCommands := func() {
		t.Helper()
		before := werewolfRead(t, a, master, event.ID)
		for _, command := range []struct {
			method, suffix string
			body           any
		}{
			{"PUT", "/roles", map[string]any{"revision": before.Revision, "roles": villager}},
			{"PUT", "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": true}},
			{"POST", "/state", map[string]any{"revision": before.Revision, "action": "start"}},
			{"POST", "/state", map[string]any{"revision": before.Revision, "action": "finish"}},
			{"DELETE", fmt.Sprintf("/players/%d", ada.id), nil},
			{"PUT", fmt.Sprintf("/players/%d", ada.id), map[string]any{"alive": false}},
			{"PUT", "/mayor", map[string]any{"guestId": ben.id}},
			{"PUT", "/phase", map[string]any{"phase": "night"}},
		} {
			for _, viewer := range []werewolfViewer{host, ada, outsider} {
				assertWelcomeError(t, werewolfDo(t, a, viewer, command.method, event.ID, command.suffix, command.body), 403, "game_master_required")
			}
		}
		after := werewolfRead(t, a, master, event.ID)
		if after.Revision != before.Revision || after.Status != before.Status || len(after.Players) != len(before.Players) || after.HideRolesOfDead != before.HideRolesOfDead {
			t.Fatalf("a refused command changed the game: %+v", after)
		}
	}
	refuseCommands()

	// The game starts only when the roles add up to the players.
	game = werewolfRead(t, a, master, event.ID)
	start := map[string]any{"revision": game.Revision, "action": "start"}
	assertWelcomeError(t, werewolfDo(t, a, master, "POST", event.ID, "/state", start), 409, "werewolf_roles_mismatch")
	werewolfID, villagerID := game.Roles[0].ID, game.Roles[1].ID
	roles := []map[string]any{
		{"id": villagerID, "key": "villager", "name": nil, "description": " Sleeps all night. ", "count": 2},
		{"id": werewolfID, "key": "werewolf", "name": nil, "description": nil, "count": 1},
		{"key": nil, "name": "  Jester ", "description": "Wins when voted out.", "count": 1},
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision - 1, "roles": roles}), 409, "activity_conflict")
	for _, invalid := range [][]map[string]any{
		{roles[1], roles[2]},
		{roles[0], {"id": 999999, "key": nil, "name": "Stranger", "description": nil, "count": 0}},
		{roles[0], {"id": werewolfID, "key": "seer", "name": nil, "description": nil, "count": 1}},
		{roles[0], {"key": nil, "name": strings.Repeat("é", 41), "description": nil, "count": 0}},
		{roles[0], {"key": "werewolf", "name": nil, "description": nil, "count": 61}},
	} {
		assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision, "roles": invalid}), 400, "invalid_werewolf_roles")
	}
	saved := werewolfGame(t, a, master, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision, "roles": roles})
	if saved.Revision <= game.Revision || len(saved.Roles) != 3 ||
		saved.Roles[0].ID != villagerID || *saved.Roles[0].Description != "Sleeps all night." || saved.Roles[0].Count != 2 ||
		saved.Roles[1].ID != werewolfID || saved.Roles[1].Description != nil ||
		saved.Roles[2].Key != nil || *saved.Roles[2].Name != "Jester" || saved.Roles[2].ID == 0 || saved.Roles[2].Count != 1 {
		t.Fatalf("saved roles=%+v", saved.Roles)
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "POST", event.ID, "/state", start), 409, "activity_conflict")
	game = werewolfState(t, a, master, event.ID, programme.WerewolfStart)

	// Every player holds exactly one role and the quantities are respected.
	dealt, quantities := map[int64]string{}, map[string]int{}
	for _, player := range game.Players {
		if player.Role == nil || !player.Alive || player.Mayor {
			t.Fatalf("player after the deal=%+v", player)
		}
		dealt[player.ID] = roleLabel(player.Role)
		quantities[roleLabel(player.Role)]++
	}
	if game.Status != programme.WerewolfRunning || len(dealt) != 4 || len(quantities) != 3 || quantities["villager"] != 2 || quantities["werewolf"] != 1 || quantities["Jester"] != 1 {
		t.Fatalf("dealt roles=%v", dealt)
	}

	// sees checks that a viewer receives the dealt roles of exactly the given
	// players, their own card as myRole, and the role list only as game master.
	sees := func(viewer werewolfViewer, visible ...werewolfViewer) {
		t.Helper()
		body := werewolfBody(t, a, viewer, event.ID)
		var view programme.Werewolf
		if err := json.Unmarshal([]byte(body), &view); err != nil {
			t.Fatal(err)
		}
		isMaster := viewer.id == master.id
		want, jesterShown := map[int64]string{}, isMaster
		for _, player := range visible {
			want[player.id] = dealt[player.id]
			jesterShown = jesterShown || dealt[player.id] == "Jester"
		}
		// The game master sees every seat; while the game runs, anyone else
		// sees their own and the dead.
		if isMaster && len(view.Players) != 4 {
			t.Fatalf("%s sees %d players", viewer.name, len(view.Players))
		}
		for _, player := range view.Players {
			if !isMaster && view.Status == programme.WerewolfRunning && player.ID != viewer.id && player.Alive {
				t.Fatalf("%s sees %s, who is alive", viewer.name, player.Name)
			}
		}
		for _, player := range view.Players {
			if roleLabel(player.Role) != want[player.ID] {
				t.Fatalf("%s sees role %q for %s, want %q", viewer.name, roleLabel(player.Role), player.Name, want[player.ID])
			}
		}
		if roleLabel(view.MyRole) != want[viewer.id] {
			t.Fatalf("%s has myRole=%q, want %q", viewer.name, roleLabel(view.MyRole), want[viewer.id])
		}
		if view.IsGameMaster != isMaster || (view.Roles != nil) != isMaster || (view.Messages != nil) != isMaster || strings.Contains(body, `"count"`) != isMaster {
			t.Fatalf("%s and the game master's lists: %s", viewer.name, body)
		}
		// The custom role's name appears nowhere else in a game.
		if strings.Contains(body, "Jester") != jesterShown {
			t.Fatalf("%s and the custom role: %s", viewer.name, body)
		}
	}
	sees(master, players...)
	for _, player := range players {
		sees(player, player)
	}
	sees(outsider)
	sees(host)
	refuseCommands()

	// Lobby commands and other transitions are refused while the game runs.
	game = werewolfRead(t, a, master, event.ID)
	for _, command := range []struct {
		viewer         werewolfViewer
		method, suffix string
		body           any
	}{
		{outsider, "POST", "/players", map[string]any{}},
		{ada, "DELETE", "/players/me", nil},
		{master, "PUT", "/roles", map[string]any{"revision": game.Revision, "roles": villager}},
		{master, "DELETE", fmt.Sprintf("/players/%d", ada.id), nil},
		{master, "POST", "/state", map[string]any{"revision": game.Revision, "action": "start"}},
		{master, "POST", "/state", map[string]any{"revision": game.Revision, "action": "reset"}},
		{master, "POST", "/state", map[string]any{"revision": game.Revision - 1, "action": "finish"}},
		{master, "PUT", "/phase", map[string]any{"phase": "dusk"}},
	} {
		assertWelcomeError(t, werewolfDo(t, a, command.viewer, command.method, event.ID, command.suffix, command.body), 409, "activity_conflict")
	}

	// The host cannot change the game master of a running game, but renaming
	// and rescheduling the event keeps the game.
	eventPath := fmt.Sprintf("/api/admin/programme/%d", event.ID)
	for _, other := range []*int64{&ada.id, nil} {
		input := programme.Input{Title: "Night falls", Werewolf: &programme.WerewolfInput{GameMasterID: other}}
		assertWelcomeError(t, request(t, a, "PUT", eventPath, input, hostCookie), 409, "activity_conflict")
	}
	startsAt := stamp(a.now().Add(time.Hour))
	response := request(t, a, "PUT", eventPath, programme.Input{Title: "The village sleeps", StartsAt: &startsAt, Werewolf: &programme.WerewolfInput{GameMasterID: &master.id}}, hostCookie)
	status(t, response, 200)
	if renamed := eventResponse(t, response); renamed.Title != "The village sleeps" || renamed.Werewolf == nil ||
		renamed.Werewolf.Status != programme.WerewolfRunning || renamed.Werewolf.Players != 4 || renamed.Werewolf.GameMaster.ID != master.id {
		t.Fatalf("renamed event=%+v", renamed)
	}
	status(t, request(t, a, "PUT", eventPath, programme.Input{Title: "The village sleeps"}, hostCookie), 200)
	sees(master, players...)

	// A death shows the role to everyone, unless deaths are secret.
	if killed := werewolfLife(t, a, master, event.ID, ben.id, false); werewolfPlayer(t, killed, ben.id).Alive {
		t.Fatal("Ben is still alive")
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, fmt.Sprintf("/players/%d", outsider.id), map[string]any{"alive": false}), 400, "invalid_werewolf_player")
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, fmt.Sprintf("/players/%d", ben.id), map[string]any{}), 400, "invalid_body")
	sees(ada, ada, ben)
	sees(ben, ben)
	sees(outsider, ben)
	sees(host, ben)
	if secret := werewolfVariants(t, a, master, event.ID, true, false); !secret.HideRolesOfDead || secret.GhostMessages {
		t.Fatalf("variants=%+v", secret)
	}
	sees(master, players...)
	sees(ada, ada)
	sees(ben, ben)
	sees(outsider)
	sees(host)
	werewolfVariants(t, a, master, event.ID, false, false)
	sees(cleo, cleo, ben)
	werewolfLife(t, a, master, event.ID, ben.id, true)
	sees(cleo, cleo)
	werewolfLife(t, a, master, event.ID, ben.id, false)

	// The mayor is one living player, or nobody.
	mayors := func(game programme.Werewolf) []int64 {
		var ids []int64
		for _, player := range game.Players {
			if player.Mayor {
				ids = append(ids, player.ID)
			}
		}
		return ids
	}
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": cleo.id})
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": ada.id})
	// The mayor is named aloud: only the game master and the mayor read it.
	for _, viewer := range everyone {
		want := []int64(nil)
		if viewer.id == master.id || viewer.id == ada.id {
			want = []int64{ada.id}
		}
		if got := mayors(werewolfRead(t, a, viewer, event.ID)); !slices.Equal(got, want) {
			t.Fatalf("%s sees mayors %v, want %v", viewer.name, got, want)
		}
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": ben.id}), 409, "activity_conflict")
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": outsider.id}), 400, "invalid_werewolf_player")
	if killed := werewolfLife(t, a, master, event.ID, ada.id, false); len(mayors(killed)) != 0 {
		t.Fatal("a dead mayor kept the title")
	}
	if revived := werewolfLife(t, a, master, event.ID, ada.id, true); len(mayors(revived)) != 0 {
		t.Fatal("a revived player became mayor again")
	}
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": ada.id})
	if cleared := werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": nil}); len(mayors(cleared)) != 0 {
		t.Fatal("the mayor was not removed")
	}
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": dan.id})

	// The end reveals every role to everyone; the role list stays with the
	// game master.
	werewolfVariants(t, a, master, event.ID, true, false)
	if finished := werewolfState(t, a, master, event.ID, programme.WerewolfFinish); finished.Status != programme.WerewolfFinished {
		t.Fatalf("finished game=%+v", finished)
	}
	for _, viewer := range everyone {
		sees(viewer, players...)
	}
	game = werewolfRead(t, a, master, event.ID)
	for _, command := range []struct {
		viewer         werewolfViewer
		method, suffix string
		body           any
	}{
		{outsider, "POST", "/players", map[string]any{}},
		{master, "PUT", fmt.Sprintf("/players/%d", ada.id), map[string]any{"alive": false}},
		{master, "PUT", "/mayor", map[string]any{"guestId": ada.id}},
		{master, "POST", "/state", map[string]any{"revision": game.Revision, "action": "finish"}},
		{master, "POST", "/state", map[string]any{"revision": game.Revision - 1, "action": "reset"}},
	} {
		assertWelcomeError(t, werewolfDo(t, a, command.viewer, command.method, event.ID, command.suffix, command.body), 409, "activity_conflict")
	}

	// Starting over keeps the players, roles and variants and clears the rest.
	game = werewolfState(t, a, master, event.ID, programme.WerewolfReset)
	if game.Status != programme.WerewolfLobby || !game.HideRolesOfDead || len(game.Players) != 4 || len(game.Roles) != 3 ||
		game.Roles[0].Count != 2 || game.Roles[2].Count != 1 || *game.Roles[2].Name != "Jester" {
		t.Fatalf("game after reset=%+v", game)
	}
	for i, player := range game.Players {
		if player.ID != players[i].id || player.Role != nil || !player.Alive || player.Mayor {
			t.Fatalf("player after reset=%+v", player)
		}
	}
	if view := werewolfRead(t, a, ada, event.ID); view.MyRole != nil || !view.Joined {
		t.Fatalf("Ada after reset=%+v", view)
	}
	if joined := werewolfGame(t, a, outsider, "POST", event.ID, "/players", map[string]any{}); len(joined.Players) != 5 {
		t.Fatalf("players after a late join=%+v", joined.Players)
	}

	// Deleting the event deletes the game.
	status(t, request(t, a, "DELETE", eventPath, nil, hostCookie), 204)
	if count := countRows(t, a, `SELECT (SELECT COUNT(*) FROM programme_werewolf_games)+(SELECT COUNT(*) FROM programme_werewolf_roles)
 +(SELECT COUNT(*) FROM programme_werewolf_players)+(SELECT COUNT(*) FROM programme_werewolf_messages)+(SELECT COUNT(*) FROM programme_activities)`); count != 0 {
		t.Fatalf("deleted game retained %d records", count)
	}
	assertWelcomeError(t, werewolfDo(t, a, master, "GET", event.ID, "", nil), 404, "not_found")
}

func TestWerewolfGhostMessagesReachOnlyTheMayorAndTheGameMaster(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	hostCookie, hostGuest := admin(t, a)
	host := werewolfViewer{name: "host", id: hostGuest.ID, cookie: hostCookie}
	event, master, players := runningWerewolf(t, a, hostCookie, "Ada", "Ben", "Cleo", "Dan", "Eli")
	ada, ben, cleo, dan, eli := players[0], players[1], players[2], players[3], players[4]
	outsider := werewolfGuest(t, a, hostCookie, "Eve")
	write := func(viewer werewolfViewer, text string) *httptest.ResponseRecorder {
		t.Helper()
		return werewolfDo(t, a, viewer, "PUT", event.ID, "/message", map[string]any{"text": text})
	}
	// readers checks who receives a text, in any field of their game.
	readers := func(text string, want ...werewolfViewer) {
		t.Helper()
		for _, viewer := range append(slices.Clone(players), master, outsider, host) {
			allowed := slices.ContainsFunc(want, func(reader werewolfViewer) bool { return reader.id == viewer.id })
			if strings.Contains(werewolfBody(t, a, viewer, event.ID), text) != allowed {
				t.Fatalf("%s reading %q: want %t", viewer.name, text, allowed)
			}
		}
	}

	// Without the variant nights still fall, but the dead cannot write.
	werewolfLife(t, a, master, event.ID, ben.id, false)
	if night := werewolfPhase(t, a, master, event.ID, programme.PhaseNight); night.Phase != programme.PhaseNight {
		t.Fatalf("night without the variant=%+v", night)
	}
	assertWelcomeError(t, write(ben, "Too early"), 403, "werewolf_message_forbidden")
	werewolfPhase(t, a, master, event.ID, programme.PhaseDay)
	werewolfVariants(t, a, master, event.ID, true, true)
	assertWelcomeError(t, write(ben, "By day"), 403, "werewolf_message_forbidden")
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/phase", map[string]any{"phase": "dusk"}), 409, "activity_conflict")
	if night := werewolfPhase(t, a, master, event.ID, programme.PhaseNight); night.Phase != programme.PhaseNight || len(night.Messages) != 0 {
		t.Fatalf("night=%+v", night)
	}

	// Only ghosts write, one message each, replaceable and removable.
	for _, viewer := range []werewolfViewer{ada, master, outsider, host} {
		assertWelcomeError(t, write(viewer, "I am not dead"), 403, "werewolf_message_forbidden")
		if werewolfRead(t, a, viewer, event.ID).CanWriteMessage {
			t.Fatalf("%s may write", viewer.name)
		}
	}
	assertWelcomeError(t, write(ben, strings.Repeat("é", 281)), 400, "invalid_werewolf_message")
	status(t, write(ben, "First draft"), 200)
	status(t, write(ben, "  "), 200)
	if view := werewolfRead(t, a, ben, event.ID); view.MyMessage != nil || !view.CanWriteMessage {
		t.Fatalf("Ben after removing his message=%+v", view)
	}
	status(t, write(ben, "Second draft"), 200)
	revision := werewolfRead(t, a, master, event.ID).Revision
	response := write(ben, " The werewolf sits by the window. ")
	status(t, response, 200)
	var view programme.Werewolf
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.MyMessage == nil || *view.MyMessage != "The werewolf sits by the window." || view.Messages != nil || view.MayorMessage != nil {
		t.Fatalf("Ben after writing=%+v", view)
	}
	game := werewolfRead(t, a, master, event.ID)
	if game.Revision != revision || len(game.Messages) != 1 || game.Messages[0].From.ID != ben.id || game.Messages[0].From.Name != "Ben" ||
		game.Messages[0].Text != "The werewolf sits by the window." || game.Messages[0].Delivered {
		t.Fatalf("messages for the game master=%+v", game.Messages)
	}
	readers("sits by the window", ben, master)
	readers("draft")

	// With a single message the draw is certain. The mayor reads it and who
	// wrote it, never the writer's secret role.
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": ada.id})
	for range 2 {
		day := werewolfPhase(t, a, master, event.ID, programme.PhaseDay)
		if day.Phase != programme.PhaseDay || len(day.Messages) != 1 || !day.Messages[0].Delivered {
			t.Fatalf("day for the game master=%+v", day)
		}
	}
	view = werewolfRead(t, a, ada, event.ID)
	if view.MayorMessage == nil || view.MayorMessage.Text != "The werewolf sits by the window." || view.MayorMessage.From.ID != ben.id ||
		view.MayorMessage.From.Name != "Ben" || werewolfPlayer(t, view, ben.id).Role != nil || view.Messages != nil {
		t.Fatalf("mayor's game=%+v", view)
	}
	readers("sits by the window", ben, master, ada)
	assertWelcomeError(t, write(ben, "Too late"), 403, "werewolf_message_forbidden")

	// The next night starts empty.
	if night := werewolfPhase(t, a, master, event.ID, programme.PhaseNight); len(night.Messages) != 0 {
		t.Fatalf("messages kept for the next night=%+v", night.Messages)
	}
	readers("sits by the window")

	// With several messages, one of them reaches the mayor and the others
	// stay between their ghost and the game master.
	werewolfLife(t, a, master, event.ID, cleo.id, false)
	werewolfLife(t, a, master, event.ID, dan.id, false)
	texts := map[int64]string{ben.id: "Ben whispers", cleo.id: "Cleo whispers", dan.id: "Dan whispers"}
	for _, ghost := range []werewolfViewer{ben, cleo, dan} {
		status(t, write(ghost, texts[ghost.id]), 200)
	}
	day := werewolfPhase(t, a, master, event.ID, programme.PhaseDay)
	var delivered []programme.WerewolfMessage
	for _, message := range day.Messages {
		if message.Text != texts[message.From.ID] {
			t.Fatalf("message=%+v", message)
		}
		if message.Delivered {
			delivered = append(delivered, message)
		}
	}
	if len(day.Messages) != 3 || len(delivered) != 1 {
		t.Fatalf("drawn messages=%+v", day.Messages)
	}
	if view = werewolfRead(t, a, ada, event.ID); view.MayorMessage == nil || view.MayorMessage.Text != delivered[0].Text || view.MayorMessage.From.ID != delivered[0].From.ID {
		t.Fatalf("mayor received %+v, drawn %+v", view.MayorMessage, delivered[0])
	}
	for _, ghost := range []werewolfViewer{ben, cleo, dan} {
		want := []werewolfViewer{ghost, master}
		if ghost.id == delivered[0].From.ID {
			want = append(want, ada)
		}
		readers(texts[ghost.id], want...)
	}

	// A mayor named after the draw reads it too; without a mayor at the
	// draw, nothing is delivered, even to a mayor named later.
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": eli.id})
	if view = werewolfRead(t, a, eli, event.ID); view.MayorMessage == nil || view.MayorMessage.Text != delivered[0].Text {
		t.Fatalf("new mayor received %+v", view.MayorMessage)
	}
	if view = werewolfRead(t, a, ada, event.ID); view.MayorMessage != nil {
		t.Fatalf("former mayor still reads %+v", view.MayorMessage)
	}
	werewolfPhase(t, a, master, event.ID, programme.PhaseNight)
	status(t, write(ben, "Nobody listens"), 200)
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": nil})
	if day = werewolfPhase(t, a, master, event.ID, programme.PhaseDay); len(day.Messages) != 1 || day.Messages[0].Delivered {
		t.Fatalf("draw without a mayor=%+v", day.Messages)
	}
	werewolfGame(t, a, master, "PUT", event.ID, "/mayor", map[string]any{"guestId": ada.id})
	readers("Nobody listens", ben, master)

	// A player brought back was never a ghost: their message goes.
	werewolfPhase(t, a, master, event.ID, programme.PhaseNight)
	status(t, write(ben, "Ben again"), 200)
	status(t, write(cleo, "Cleo again"), 200)
	if revived := werewolfLife(t, a, master, event.ID, ben.id, true); len(revived.Messages) != 1 || revived.Messages[0].From.ID != cleo.id {
		t.Fatalf("messages after a revival=%+v", revived.Messages)
	}
	assertWelcomeError(t, write(ben, "Alive"), 403, "werewolf_message_forbidden")

	// Turning the variant off clears the messages; the night goes on.
	off := werewolfVariants(t, a, master, event.ID, true, false)
	if off.Phase != programme.PhaseNight || len(off.Messages) != 0 || off.GhostMessages {
		t.Fatalf("game without the variant=%+v", off)
	}
	readers("Cleo again")
	assertWelcomeError(t, write(cleo, "Variant off"), 403, "werewolf_message_forbidden")

	// A finished game shows no message to players, and a reset clears them
	// with the phase.
	werewolfVariants(t, a, master, event.ID, true, true)
	werewolfPhase(t, a, master, event.ID, programme.PhaseNight)
	status(t, write(cleo, "Last words"), 200)
	if finished := werewolfState(t, a, master, event.ID, programme.WerewolfFinish); finished.Phase != programme.PhaseNight || len(finished.Messages) != 1 {
		t.Fatalf("finished game=%+v", finished)
	}
	readers("Last words", master)
	assertWelcomeError(t, write(cleo, "After the end"), 403, "werewolf_message_forbidden")
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/phase", map[string]any{"phase": "day"}), 409, "activity_conflict")
	if reset := werewolfState(t, a, master, event.ID, programme.WerewolfReset); reset.Phase != programme.PhaseDay || len(reset.Messages) != 0 || !reset.GhostMessages {
		t.Fatalf("game after reset=%+v", reset)
	}
	if countRows(t, a, "SELECT COUNT(*) FROM programme_werewolf_messages") != 0 {
		t.Fatal("a reset kept ghost messages")
	}
}

func TestWerewolfRequiresAnUnlockedEventAndFullAccess(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	hostCookie, hostGuest := admin(t, a)
	host := werewolfViewer{name: "host", id: hostGuest.ID, cookie: hostCookie}
	master, visitor := werewolfGuest(t, a, hostCookie, "Morgan"), werewolfGuest(t, a, hostCookie, "Ada")

	// Unknown events and events of another type have no game.
	response := request(t, a, "POST", "/api/admin/programme", programme.Input{Title: "Cake"}, hostCookie)
	status(t, response, 201)
	ordinary := eventResponse(t, response)
	round := questionEvent(t, a, hostCookie)
	for _, eventID := range []int64{ordinary.ID, round.ID, 999999} {
		assertWelcomeError(t, werewolfDo(t, a, visitor, "GET", eventID, "", nil), 404, "not_found")
		assertWelcomeError(t, werewolfDo(t, a, visitor, "POST", eventID, "/players", map[string]any{}), 404, "not_found")
		assertWelcomeError(t, werewolfDo(t, a, host, "PUT", eventID, "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": true}), 404, "not_found")
	}
	assertWelcomeError(t, request(t, a, "GET", "/api/programme/0/werewolf", nil, visitor.cookie), 400, "invalid_id")

	// A locked event hides its game from everyone on these routes, and from
	// guests in the programme.
	unlock := a.now().Add(time.Hour)
	input := programme.Input{Type: programme.TypeWerewolf, Title: "Night falls", Teaser: "A surprise", UnlockAt: ptr(stamp(unlock)),
		Werewolf: &programme.WerewolfInput{GameMasterID: &master.id}}
	response = request(t, a, "POST", "/api/admin/programme", input, hostCookie)
	status(t, response, 201)
	event := eventResponse(t, response)
	if !event.Locked || event.Werewolf == nil || event.Werewolf.GameMaster.ID != master.id {
		t.Fatalf("locked event for its host=%+v", event)
	}
	response = request(t, a, "GET", "/api/programme", nil, visitor.cookie)
	status(t, response, 200)
	if body := response.Body.String(); !strings.Contains(body, `"werewolf":null`) || strings.Contains(body, "Morgan") || strings.Contains(body, "Night falls") {
		t.Fatalf("locked game leaked: %s", body)
	}
	for _, viewer := range []werewolfViewer{visitor, master, host} {
		assertWelcomeError(t, werewolfDo(t, a, viewer, "GET", event.ID, "", nil), 404, "not_found")
		assertWelcomeError(t, werewolfDo(t, a, viewer, "POST", event.ID, "/players", map[string]any{}), 404, "not_found")
		assertWelcomeError(t, werewolfDo(t, a, viewer, "PUT", event.ID, "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": true}), 404, "not_found")
	}
	a.now = func() time.Time { return unlock }
	if game := werewolfGame(t, a, visitor, "POST", event.ID, "/players", map[string]any{}); !game.Joined {
		t.Fatalf("unlocked game=%+v", game)
	}
	status(t, werewolfDo(t, a, visitor, "GET", event.ID, "", nil), 200)
	status(t, request(t, a, "GET", werewolfPath(event.ID, ""), nil, nil), 401)

	// Bodies are read like everywhere else: unknown fields and missing
	// switches are refused.
	for _, command := range []struct {
		method, suffix string
		body           any
	}{
		{"POST", "/players", map[string]any{"guestId": visitor.id}},
		{"PUT", "/variants", map[string]any{"hideRolesOfDead": true}},
		{"PUT", "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": true, "revision": 1}},
		{"PUT", "/phase", map[string]any{"phase": "night", "draw": false}},
		{"PUT", "/roles", map[string]any{"revision": 1, "roles": []map[string]any{{"key": "villager", "count": 1, "role": "seer"}}}},
	} {
		assertWelcomeError(t, werewolfDo(t, a, master, command.method, event.ID, command.suffix, command.body), 400, "invalid_body")
	}

	// A guest held in the welcome sequence is kept out, by the route and by
	// the transaction itself; so is a revoked guest.
	state := changeWelcome(t, a, hostCookie, 0, "start")
	assertWelcomeError(t, werewolfDo(t, a, visitor, "GET", event.ID, "", nil), 423, "welcome_required")
	assertWelcomeError(t, werewolfDo(t, a, visitor, "DELETE", event.ID, "/players/me", nil), 423, "welcome_required")
	assertWelcomeError(t, werewolfDo(t, a, master, "PUT", event.ID, "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": true}), 423, "welcome_required")
	actor := programme.Actor{GuestID: visitor.id, SessionHash: identity.HashToken(visitor.cookie.Value)}
	if _, err := a.werewolf.Leave(t.Context(), actor, event.ID); err != access.ErrWelcome {
		t.Fatalf("transaction bypassed welcome: %v", err)
	}
	if _, err := a.werewolf.Read(t.Context(), actor, event.ID); err != access.ErrWelcome {
		t.Fatalf("read bypassed welcome: %v", err)
	}
	status(t, werewolfDo(t, a, host, "GET", event.ID, "", nil), 200)
	changeWelcome(t, a, hostCookie, state.Revision, "open")
	status(t, werewolfDo(t, a, visitor, "GET", event.ID, "", nil), 200)
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", visitor.id), nil, hostCookie), 204)
	status(t, werewolfDo(t, a, visitor, "GET", event.ID, "", nil), 401)
	if _, err := a.werewolf.Leave(t.Context(), actor, event.ID); err != access.ErrExpired {
		t.Fatalf("transaction bypassed revocation: %v", err)
	}
	// A revoked player keeps their seat until the game master removes them.
	if game := werewolfRead(t, a, master, event.ID); len(game.Players) != 1 || game.Players[0].Name != "Ada" {
		t.Fatalf("players after a revocation=%+v", game.Players)
	}
}

func TestWerewolfGameMasterIsChosenByTheHost(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	hostCookie, hostGuest := admin(t, a)
	host := werewolfViewer{name: "host", id: hostGuest.ID, cookie: hostCookie}
	ada, ben := werewolfGuest(t, a, hostCookie, "Ada"), werewolfGuest(t, a, hostCookie, "Ben")
	revoked := werewolfGuest(t, a, hostCookie, "Gone")
	status(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/guests/%d", revoked.id), nil, hostCookie), 204)

	// The game master is an active guest; a refused creation leaves nothing.
	for _, id := range []int64{revoked.id, 999999} {
		input := programme.Input{Type: programme.TypeWerewolf, Title: "Night falls", Werewolf: &programme.WerewolfInput{GameMasterID: &id}}
		assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", input, hostCookie), 400, "invalid_vote_option")
	}
	settings := programme.Input{Type: programme.TypeEvent, Title: "Cake", Werewolf: &programme.WerewolfInput{GameMasterID: &ada.id}}
	assertWelcomeError(t, request(t, a, "POST", "/api/admin/programme", settings, hostCookie), 400, "invalid_event")
	if countRows(t, a, "SELECT (SELECT COUNT(*) FROM events)+(SELECT COUNT(*) FROM programme_werewolf_games)") != 0 {
		t.Fatal("a refused creation left records")
	}

	// Without a game master, nobody commands; guests can already join.
	response := request(t, a, "POST", "/api/admin/programme", programme.Input{Type: programme.TypeWerewolf, Title: "Night falls"}, hostCookie)
	status(t, response, 201)
	event := eventResponse(t, response)
	if event.Werewolf == nil || event.Werewolf.GameMaster != nil {
		t.Fatalf("event without a game master=%+v", event)
	}
	for _, viewer := range []werewolfViewer{host, ada} {
		assertWelcomeError(t, werewolfDo(t, a, viewer, "PUT", event.ID, "/variants", map[string]any{"hideRolesOfDead": true, "ghostMessages": false}), 403, "game_master_required")
	}
	for _, player := range []werewolfViewer{ada, ben, host} {
		werewolfGame(t, a, player, "POST", event.ID, "/players", map[string]any{})
	}

	// A player who becomes game master leaves the players.
	eventPath := fmt.Sprintf("/api/admin/programme/%d", event.ID)
	update := func(input programme.Input) *httptest.ResponseRecorder {
		t.Helper()
		input.Title = "Night falls"
		return request(t, a, "PUT", eventPath, input, hostCookie)
	}
	assertWelcomeError(t, request(t, a, "PUT", eventPath, programme.Input{Title: "Night falls", Werewolf: &programme.WerewolfInput{GameMasterID: &ada.id}}, ada.cookie), 403, "admin_required")
	assertWelcomeError(t, update(programme.Input{Werewolf: &programme.WerewolfInput{GameMasterID: &revoked.id}}), 400, "invalid_vote_option")
	assertWelcomeError(t, update(programme.Input{Type: programme.TypeVote, Vote: &programme.VoteInput{Question: "Who?", Choices: programme.ChoicesCustom, Labels: []string{"A", "B"}}}), 409, "activity_conflict")
	response = update(programme.Input{Werewolf: &programme.WerewolfInput{GameMasterID: &ada.id}})
	status(t, response, 200)
	if summary := eventResponse(t, response).Werewolf; summary.GameMaster == nil || summary.GameMaster.ID != ada.id || summary.Players != 2 {
		t.Fatalf("summary after naming a player=%+v", summary)
	}
	game := werewolfRead(t, a, ada, event.ID)
	if !game.IsGameMaster || game.Joined || len(game.Players) != 2 || game.Players[0].ID != ben.id || game.Roles == nil {
		t.Fatalf("new game master's game=%+v", game)
	}

	// Omitting the settings keeps the game master; null removes them; the
	// host can lead the game too.
	response = update(programme.Input{})
	status(t, response, 200)
	if summary := eventResponse(t, response).Werewolf; summary.GameMaster == nil || summary.GameMaster.ID != ada.id {
		t.Fatalf("summary after a metadata edit=%+v", summary)
	}
	response = update(programme.Input{Type: programme.TypeWerewolf, Werewolf: &programme.WerewolfInput{}})
	status(t, response, 200)
	if summary := eventResponse(t, response).Werewolf; summary.GameMaster != nil {
		t.Fatalf("summary after removing the game master=%+v", summary)
	}
	if game = werewolfRead(t, a, ada, event.ID); game.IsGameMaster || game.Roles != nil || game.GameMaster != nil {
		t.Fatalf("former game master's game=%+v", game)
	}
	status(t, update(programme.Input{Werewolf: &programme.WerewolfInput{GameMasterID: &host.id}}), 200)
	if game = werewolfRead(t, a, host, event.ID); !game.IsGameMaster || game.Joined || len(game.Players) != 1 || game.Roles == nil {
		t.Fatalf("host as game master=%+v", game)
	}

	// Two players and two roles are not enough to start.
	werewolfGame(t, a, ada, "POST", event.ID, "/players", map[string]any{})
	roles := []map[string]any{
		{"id": game.Roles[0].ID, "key": "werewolf", "name": nil, "description": nil, "count": 1},
		{"id": game.Roles[1].ID, "key": "villager", "name": nil, "description": nil, "count": 1},
	}
	game = werewolfGame(t, a, host, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision, "roles": roles})
	assertWelcomeError(t, werewolfDo(t, a, host, "POST", event.ID, "/state", map[string]any{"revision": game.Revision, "action": "start"}), 409, "werewolf_roles_mismatch")

	// A game seats at most 60 players.
	if _, err := a.db.Exec(`WITH seated AS (
 INSERT INTO guests(name,role) SELECT 'Seat '||n,'guest' FROM generate_series(1,58) AS n RETURNING id)
 INSERT INTO programme_werewolf_players(activity_id,guest_id)
 SELECT a.id,seated.id FROM programme_activities a CROSS JOIN seated WHERE a.event_id=$1`, event.ID); err != nil {
		t.Fatal(err)
	}
	late := werewolfGuest(t, a, hostCookie, "Late")
	assertWelcomeError(t, werewolfDo(t, a, late, "POST", event.ID, "/players", map[string]any{}), 409, "werewolf_player_limit")
	if game = werewolfGame(t, a, ben, "POST", event.ID, "/players", map[string]any{}); len(game.Players) != 60 || !game.Joined {
		t.Fatalf("a seated player joining again sees %d players", len(game.Players))
	}
}

func TestConcurrentWerewolfStartsDealOnce(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	hostCookie, _ := admin(t, a)
	master := werewolfGuest(t, a, hostCookie, "Morgan")
	event := werewolfEvent(t, a, hostCookie, &master.id)
	players := []werewolfViewer{werewolfGuest(t, a, hostCookie, "Ada"), werewolfGuest(t, a, hostCookie, "Ben"), werewolfGuest(t, a, hostCookie, "Cleo")}
	for _, player := range players {
		werewolfGame(t, a, player, "POST", event.ID, "/players", map[string]any{})
	}
	game := werewolfRead(t, a, master, event.ID)
	roles := []map[string]any{
		{"id": game.Roles[0].ID, "key": "werewolf", "name": nil, "description": nil, "count": 1},
		{"id": game.Roles[1].ID, "key": "villager", "name": nil, "description": nil, "count": 2},
	}
	game = werewolfGame(t, a, master, "PUT", event.ID, "/roles", map[string]any{"revision": game.Revision, "roles": roles})
	codes := make(chan int, 4)
	var group sync.WaitGroup
	for range 4 {
		group.Add(1)
		go func() {
			defer group.Done()
			codes <- werewolfDo(t, a, master, "POST", event.ID, "/state", map[string]any{"revision": game.Revision, "action": "start"}).Code
		}()
	}
	group.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 3 {
		t.Fatalf("concurrent starts=%v", counts)
	}
	started := werewolfRead(t, a, master, event.ID)
	if started.Revision != game.Revision+1 || started.Status != programme.WerewolfRunning {
		t.Fatalf("game after concurrent starts=%+v", started)
	}
}

func TestWerewolfEventIsAnnouncedAndInvalidatesTheProgramme(t *testing.T) {
	t.Parallel()
	a := testApp(t)
	base := a.now()
	now := base
	a.now = func() time.Time { return now }
	hostCookie, _ := admin(t, a)
	master, visitor := werewolfGuest(t, a, hostCookie, "Morgan"), werewolfGuest(t, a, hostCookie, "Ada")
	device := testNotificationInput(t)
	status(t, request(t, a, "PUT", "/api/notifications/subscription", device, visitor.cookie), 200)

	// A werewolf event has no draft: its start is announced like any event's.
	start := base.Add(10 * time.Minute)
	input := programme.Input{Type: programme.TypeWerewolf, Title: "Night falls", StartsAt: ptr(stamp(start)), Werewolf: &programme.WerewolfInput{GameMasterID: &master.id}}
	response := request(t, a, "POST", "/api/admin/programme", input, hostCookie)
	status(t, response, 201)
	event := eventResponse(t, response)
	announce(t, a, 0)
	now = start
	announce(t, a, 1)
	if queued := queuedAnnouncements(t, a, now, device.Endpoint); !slices.Equal(queued, []string{"programme_start:Night falls"}) {
		t.Fatalf("queued announcements=%q", queued)
	}

	// Every change tells clients to fetch their own view: the socket carries
	// the topic and nothing of the game.
	server := httptest.NewServer(a.Handler())
	defer server.Close()
	masterSocket, visitorSocket := dialRealtime(t, a, server, master.cookie), dialRealtime(t, a, server, visitor.cookie)
	sockets := []*testRealtimeConnection{masterSocket, visitorSocket}
	for _, socket := range sockets {
		readRealtime(t, socket, "ready")
	}
	werewolfGame(t, a, visitor, "POST", event.ID, "/players", map[string]any{})
	for _, socket := range sockets {
		readRealtime(t, socket, "invalidate", "programme")
	}
	werewolfVariants(t, a, master, event.ID, true, true)
	for _, socket := range sockets {
		readRealtime(t, socket, "invalidate", "programme")
	}
	werewolfRead(t, a, visitor, event.ID)
	assertWelcomeError(t, werewolfDo(t, a, visitor, "PUT", event.ID, "/variants", map[string]any{"hideRolesOfDead": false, "ghostMessages": false}), 403, "game_master_required")
	for _, socket := range sockets {
		noRealtime(t, socket)
	}
}
