package programme

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"
)

// The cast of the visibility tests. Ada is the mayor; Ben and Dan are dead.
// The outsider did not join, and neither did the party's host: the view only
// knows guest IDs, so a host is whichever of these they happen to be.
const (
	masterID   int64 = 1
	adaID      int64 = 10
	benID      int64 = 11
	cleoID     int64 = 12
	danID      int64 = 13
	outsiderID int64 = 20
	hostID     int64 = 30
)

func text(value string) *string { return &value }

// werewolfFixture builds a game with one distinct role per player, so every
// role and every message can be recognized in a serialized view.
func werewolfFixture(status WerewolfStatus, hideRolesOfDead, ghostMessages bool, phase WerewolfPhase) WerewolfGame {
	game := WerewolfGame{
		Status: status, Revision: 4, GameMaster: &Person{ID: masterID, Name: "Morgan"},
		HideRolesOfDead: hideRolesOfDead, GhostMessages: ghostMessages, Phase: phase,
		Roles: []WerewolfRole{
			{ID: 100, Count: 1, RoleCard: RoleCard{Key: text(RoleWerewolf)}},
			{ID: 101, Count: 1, RoleCard: RoleCard{Key: text(RoleSeer), Description: text("Peeks at one card each night.")}},
			{ID: 102, Count: 1, RoleCard: RoleCard{Key: text(RoleVillager)}},
			{ID: 103, Count: 1, RoleCard: RoleCard{Name: text("Jester"), Description: text("Wins when voted out.")}},
			{ID: 104, Count: 0, RoleCard: RoleCard{Key: text(RoleWitch)}},
		},
		Players: []WerewolfSeat{
			{Person: Person{ID: adaID, Name: "Ada"}, Alive: true},
			{Person: Person{ID: benID, Name: "Ben"}, Alive: true},
			{Person: Person{ID: cleoID, Name: "Cleo"}, Alive: true},
			{Person: Person{ID: danID, Name: "Dan"}, Alive: true},
		},
	}
	if status == WerewolfLobby {
		return game
	}
	for i := range game.Players {
		game.Players[i].RoleID = game.Roles[i].ID
	}
	game.Players[0].Mayor = true
	game.Players[1].Alive, game.Players[3].Alive = false, false
	// The messages stay in the fixture with the variant off: the view alone
	// must keep them from players.
	game.Messages = []GhostMessage{
		{AuthorID: benID, Text: "Ben's hint", Delivered: ghostMessages && phase == PhaseDay},
		{AuthorID: danID, Text: "Dan's hint"},
	}
	return game
}

// sight is what one viewer is expected to receive.
type sight struct {
	seats string // IDs of the players listed, in join order; empty means everyone
	roles string // IDs of the players whose role is shown, in join order
	list  bool   // the role list and every ghost message: the game master's view
	write bool
	mine  string // the viewer's own message
	drawn string // the message delivered to the mayor
}

func TestWerewolfViewShowsEachAudienceOnlyWhatItMaySee(t *testing.T) {
	const everyone = "10 11 12 13"
	nobody := map[int64]sight{masterID: {list: true}, adaID: {}, benID: {}, cleoID: {}, danID: {}, outsiderID: {}, hostID: {}}
	revealed := map[int64]sight{
		masterID: {roles: everyone, list: true}, adaID: {roles: everyone}, benID: {roles: everyone}, cleoID: {roles: everyone},
		danID: {roles: everyone}, outsiderID: {roles: everyone}, hostID: {roles: everyone},
	}
	for _, tc := range []struct {
		name            string
		status          WerewolfStatus
		hideRolesOfDead bool
		ghostMessages   bool
		phase           WerewolfPhase
		want            map[int64]sight
	}{
		{"lobby", WerewolfLobby, false, false, PhaseDay, nobody},
		{"lobby with both variants", WerewolfLobby, true, true, PhaseDay, nobody},
		{"running, deaths shown", WerewolfRunning, false, false, PhaseDay, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10 11 13"}, benID: {seats: "11 13", roles: "11 13"},
			cleoID: {seats: "11 12 13", roles: "11 12 13"}, danID: {seats: "11 13", roles: "11 13"},
			outsiderID: {seats: "11 13", roles: "11 13"}, hostID: {seats: "11 13", roles: "11 13"},
		}},
		{"running, secret deaths", WerewolfRunning, true, false, PhaseDay, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10"}, benID: {seats: "11 13", roles: "11"},
			cleoID: {seats: "11 12 13", roles: "12"}, danID: {seats: "11 13", roles: "13"},
			outsiderID: {seats: "11 13"}, hostID: {seats: "11 13"},
		}},
		{"running night, ghost messages", WerewolfRunning, false, true, PhaseNight, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10 11 13"},
			benID:      {seats: "11 13", roles: "11 13", write: true, mine: "Ben's hint"},
			cleoID:     {seats: "11 12 13", roles: "11 12 13"},
			danID:      {seats: "11 13", roles: "11 13", write: true, mine: "Dan's hint"},
			outsiderID: {seats: "11 13", roles: "11 13"}, hostID: {seats: "11 13", roles: "11 13"},
		}},
		{"running night, both variants", WerewolfRunning, true, true, PhaseNight, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10"},
			benID:      {seats: "11 13", roles: "11", write: true, mine: "Ben's hint"},
			cleoID:     {seats: "11 12 13", roles: "12"},
			danID:      {seats: "11 13", roles: "13", write: true, mine: "Dan's hint"},
			outsiderID: {seats: "11 13"}, hostID: {seats: "11 13"},
		}},
		{"running day, ghost messages", WerewolfRunning, false, true, PhaseDay, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10 11 13", drawn: "Ben's hint"},
			benID: {seats: "11 13", roles: "11 13", mine: "Ben's hint"}, cleoID: {seats: "11 12 13", roles: "11 12 13"},
			danID:      {seats: "11 13", roles: "11 13", mine: "Dan's hint"},
			outsiderID: {seats: "11 13", roles: "11 13"}, hostID: {seats: "11 13", roles: "11 13"},
		}},
		{"running day, both variants", WerewolfRunning, true, true, PhaseDay, map[int64]sight{
			masterID: {roles: everyone, list: true}, adaID: {seats: "10 11 13", roles: "10", drawn: "Ben's hint"},
			benID: {seats: "11 13", roles: "11", mine: "Ben's hint"}, cleoID: {seats: "11 12 13", roles: "12"},
			danID:      {seats: "11 13", roles: "13", mine: "Dan's hint"},
			outsiderID: {seats: "11 13"}, hostID: {seats: "11 13"},
		}},
		{"finished", WerewolfFinished, false, false, PhaseDay, revealed},
		{"finished, secret deaths", WerewolfFinished, true, false, PhaseDay, revealed},
		{"finished by day, both variants", WerewolfFinished, true, true, PhaseDay, revealed},
		{"finished by night, both variants", WerewolfFinished, true, true, PhaseNight, revealed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			game := werewolfFixture(tc.status, tc.hideRolesOfDead, tc.ghostMessages, tc.phase)
			if len(tc.want) != 7 {
				t.Fatalf("the case covers %d audiences, want 7", len(tc.want))
			}
			for viewerID, want := range tc.want {
				assertSight(t, game, viewerID, want)
			}
		})
	}
}

func assertSight(t *testing.T, game WerewolfGame, viewerID int64, want sight) {
	t.Helper()
	view := game.View(viewerID)
	_, playing := game.seat(viewerID)
	if view.IsGameMaster != (viewerID == masterID) || view.Joined != playing {
		t.Errorf("viewer %d: isGameMaster=%t joined=%t", viewerID, view.IsGameMaster, view.Joined)
	}
	var shown, listed []string
	var own *RoleCard
	for _, player := range view.Players {
		listed = append(listed, fmt.Sprint(player.ID))
		seat, _ := game.seat(player.ID)
		if player.Person != seat.Person || player.Alive != seat.Alive || player.Mayor != seat.Mayor {
			t.Errorf("viewer %d: the board shows %+v for %+v", viewerID, player, seat)
		}
		if player.Role != nil {
			shown = append(shown, fmt.Sprint(player.ID))
		}
		if player.ID == viewerID {
			own = player.Role
		}
	}
	seats := want.seats
	if seats == "" {
		seats = "10 11 12 13"
	}
	if got := strings.Join(listed, " "); got != seats {
		t.Errorf("viewer %d sees the seats of %q, want %q", viewerID, got, seats)
	}
	if got := strings.Join(shown, " "); got != want.roles {
		t.Errorf("viewer %d sees the roles of %q, want %q", viewerID, got, want.roles)
	}
	if view.MyRole != own {
		t.Errorf("viewer %d: myRole=%v but their seat shows %v", viewerID, view.MyRole, own)
	}
	if (view.Roles != nil) != want.list || (view.Messages != nil) != want.list {
		t.Errorf("viewer %d: role list %v and messages %v, want game master view=%t", viewerID, view.Roles, view.Messages, want.list)
	}
	if want.list && (len(view.Roles) != len(game.Roles) || len(view.Messages) != len(game.Messages)) {
		t.Errorf("the game master sees %d roles and %d messages", len(view.Roles), len(view.Messages))
	}
	for i, message := range view.Messages {
		if message.Text != game.Messages[i].Text || message.Delivered != game.Messages[i].Delivered || message.From.ID != game.Messages[i].AuthorID {
			t.Errorf("the game master reads %+v for %+v", message, game.Messages[i])
		}
	}
	if view.CanWriteMessage != want.write {
		t.Errorf("viewer %d: canWriteMessage=%t", viewerID, view.CanWriteMessage)
	}
	if mine := deref(view.MyMessage); mine != want.mine {
		t.Errorf("viewer %d: myMessage=%q, want %q", viewerID, mine, want.mine)
	}
	drawn := ""
	if view.MayorMessage != nil {
		drawn = view.MayorMessage.Text
		if view.MayorMessage.From != (Person{ID: benID, Name: "Ben"}) {
			t.Errorf("the mayor's message comes from %+v", view.MayorMessage.From)
		}
	}
	if drawn != want.drawn {
		t.Errorf("viewer %d: mayorMessage=%q, want %q", viewerID, drawn, want.drawn)
	}

	// What reaches the client is the JSON: every secret in it must be one
	// the expectations above allow.
	body, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	markers := map[int64]string{100: `"key":"werewolf"`, 101: `"key":"seer"`, 102: `"key":"villager"`, 103: `"name":"Jester"`, 104: `"key":"witch"`}
	for i, role := range game.Roles {
		visible := want.list
		if i < len(game.Players) && slices.Contains(shown, fmt.Sprint(game.Players[i].ID)) {
			visible = true
		}
		if strings.Contains(string(body), markers[role.ID]) != visible {
			t.Errorf("viewer %d: %s in the response=%t, want %t", viewerID, markers[role.ID], !visible, visible)
		}
	}
	for _, message := range game.Messages {
		visible := want.list || message.Text == want.mine || message.Text == want.drawn
		if strings.Contains(string(body), message.Text) != visible {
			t.Errorf("viewer %d: message %q in the response=%t, want %t", viewerID, message.Text, !visible, visible)
		}
	}
	if !want.list && strings.Contains(string(body), `"count"`) {
		t.Errorf("viewer %d received role quantities", viewerID)
	}
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func TestWerewolfGameHasNoJSONForm(t *testing.T) {
	game := werewolfFixture(WerewolfRunning, true, true, PhaseNight)
	if _, err := json.Marshal(game); err == nil {
		t.Fatal("the complete state was serialized")
	}
	if _, err := json.Marshal(map[string]any{"game": &game}); err == nil {
		t.Fatal("the complete state was serialized inside another value")
	}
}

func TestWerewolfRolesAreValidatedAndNormalized(t *testing.T) {
	villager := WerewolfRoleInput{Key: text(RoleVillager), Count: 2}
	tooMany := []WerewolfRoleInput{villager}
	for i := range WerewolfRoleLimit {
		tooMany = append(tooMany, WerewolfRoleInput{Name: text(fmt.Sprint("Extra ", i))})
	}
	for _, tc := range []struct {
		name  string
		roles []WerewolfRoleInput
	}{
		{"no role", nil},
		{"more than 20 roles", tooMany},
		{"no villager", []WerewolfRoleInput{{Key: text(RoleWerewolf), Count: 1}}},
		{"unknown built-in key", []WerewolfRoleInput{villager, {Key: text("vampire")}}},
		{"built-in key twice", []WerewolfRoleInput{villager, villager}},
		{"built-in role with a name", []WerewolfRoleInput{{Key: text(RoleVillager), Name: text("Peasant")}}},
		{"custom role without a name", []WerewolfRoleInput{villager, {}}},
		{"custom role with a blank name", []WerewolfRoleInput{villager, {Name: text(" \t ")}}},
		{"name of 41 characters", []WerewolfRoleInput{villager, {Name: text(strings.Repeat("é", 41))}}},
		{"description of 601 characters", []WerewolfRoleInput{villager, {Name: text("Jester"), Description: text(strings.Repeat("é", 601))}}},
		{"negative quantity", []WerewolfRoleInput{{Key: text(RoleVillager), Count: -1}}},
		{"quantity of 61", []WerewolfRoleInput{{Key: text(RoleVillager), Count: 61}}},
		{"negative ID", []WerewolfRoleInput{villager, {ID: -1, Name: text("Jester")}}},
		{"same ID twice", []WerewolfRoleInput{{ID: 7, Key: text(RoleVillager)}, {ID: 7, Name: text("Jester")}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := normalizeWerewolfRoles(tc.roles); err != ErrInvalidWerewolfRoles {
				t.Fatalf("error=%v", err)
			}
		})
	}

	roles, err := normalizeWerewolfRoles([]WerewolfRoleInput{
		{ID: 3, Key: text(RoleVillager), Description: text("  "), Count: 60},
		{Key: text(RoleSeer), Description: text("  Peeks at night.  ")},
		{Name: text("  " + strings.Repeat("é", 40) + " "), Description: text(strings.Repeat("é", 600))},
		{Name: text("Jester")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if roles[0].ID != 3 || roles[0].Description != nil || roles[0].Count != 60 {
		t.Errorf("an empty description was kept: %+v", roles[0])
	}
	if *roles[1].Description != "Peeks at night." || *roles[2].Name != strings.Repeat("é", 40) || roles[3].Description != nil {
		t.Errorf("texts were not trimmed: %q %q", *roles[1].Description, *roles[2].Name)
	}

	defaults, err := normalizeWerewolfRoles(DefaultWerewolfRoles())
	if err != nil || len(defaults) != 7 {
		t.Fatalf("default roles: %v %+v", err, defaults)
	}
	for i, role := range defaults {
		want := 0
		if *role.Key == RoleWerewolf {
			want = 1
		}
		if role.Count != want || role.Name != nil || role.Description != nil || *role.Key != builtinRoles[i] {
			t.Errorf("default role %d = %+v", i, role)
		}
	}
}

func TestWerewolfDealGivesEachPlayerOneRoleAndRespectsQuantities(t *testing.T) {
	roles := []WerewolfRole{{ID: 1, Count: 2}, {ID: 2, Count: 3}, {ID: 3, Count: 0}, {ID: 4, Count: 1}}
	players := []int64{10, 11, 12, 13, 14, 15}
	for _, tc := range []struct {
		name    string
		players []int64
		roles   []WerewolfRole
	}{
		{"fewer roles than players", players, []WerewolfRole{{ID: 1, Count: 5}}},
		{"more roles than players", players, []WerewolfRole{{ID: 1, Count: 7}}},
		{"two players", players[:2], []WerewolfRole{{ID: 1, Count: 2}}},
		{"nobody", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if dealt, err := DealWerewolfRoles(tc.players, tc.roles, rand.New(rand.NewPCG(1, 2))); err != ErrWerewolfRolesMismatch || dealt != nil {
				t.Fatalf("dealt %v, error=%v", dealt, err)
			}
		})
	}
	if _, err := DealWerewolfRoles(players[:3], []WerewolfRole{{ID: 1, Count: 3}}, rand.New(rand.NewPCG(1, 2))); err != nil {
		t.Fatalf("three players could not start: %v", err)
	}

	deal := func(seed uint64) map[int64]int64 {
		dealt, err := DealWerewolfRoles(players, roles, rand.New(rand.NewPCG(seed, 7)))
		if err != nil {
			t.Fatal(err)
		}
		return dealt
	}
	distinct := map[string]bool{}
	for seed := range uint64(50) {
		dealt := deal(seed)
		counts := map[int64]int{}
		for _, playerID := range players {
			roleID, ok := dealt[playerID]
			if !ok {
				t.Fatalf("player %d has no role in %v", playerID, dealt)
			}
			counts[roleID]++
		}
		if len(dealt) != len(players) || counts[1] != 2 || counts[2] != 3 || counts[3] != 0 || counts[4] != 1 {
			t.Fatalf("seed %d dealt %v", seed, dealt)
		}
		if again := deal(seed); fmt.Sprint(again) != fmt.Sprint(dealt) {
			t.Fatalf("the same randomness dealt %v then %v", dealt, again)
		}
		distinct[fmt.Sprint(dealt)] = true
	}
	if len(distinct) < 10 {
		t.Fatalf("50 sources of randomness produced only %d deals", len(distinct))
	}
}

func TestWerewolfDrawDeliversOneMessageOnlyToAMayor(t *testing.T) {
	game := werewolfFixture(WerewolfRunning, false, true, PhaseNight)
	drawn := map[int64]int{}
	for seed := range uint64(200) {
		authorID, delivered := game.DrawMessage(rand.New(rand.NewPCG(seed, 3)))
		if !delivered {
			t.Fatal("nothing was drawn for the mayor")
		}
		drawn[authorID]++
	}
	if len(drawn) != 2 || drawn[benID] < 50 || drawn[danID] < 50 {
		t.Fatalf("draws were not spread over the messages: %v", drawn)
	}

	game.Messages = game.Messages[:1]
	if authorID, delivered := game.DrawMessage(rand.New(rand.NewPCG(1, 2))); !delivered || authorID != benID {
		t.Fatalf("a single message was not delivered: %d %t", authorID, delivered)
	}
	game.Messages = nil
	if _, delivered := game.DrawMessage(rand.New(rand.NewPCG(1, 2))); delivered {
		t.Fatal("a message was delivered from an empty night")
	}
	game = werewolfFixture(WerewolfRunning, false, true, PhaseNight)
	game.Players[0].Mayor = false
	if _, delivered := game.DrawMessage(rand.New(rand.NewPCG(1, 2))); delivered {
		t.Fatal("a message was delivered without a mayor")
	}
}

func TestWerewolfCommandsFollowStateRevisionAndGameMaster(t *testing.T) {
	lobby := werewolfFixture(WerewolfLobby, false, false, PhaseDay)
	running := werewolfFixture(WerewolfRunning, false, true, PhaseNight)
	finished := werewolfFixture(WerewolfFinished, false, false, PhaseDay)
	full := werewolfFixture(WerewolfLobby, false, false, PhaseDay)
	for id := int64(100); len(full.Players) < WerewolfPlayerLimit; id++ {
		full.Players = append(full.Players, WerewolfSeat{Person: Person{ID: id}, Alive: true})
	}
	withoutMaster := werewolfFixture(WerewolfLobby, false, false, PhaseDay)
	withoutMaster.GameMaster = nil
	day := werewolfFixture(WerewolfRunning, false, true, PhaseDay)
	withoutGhosts := werewolfFixture(WerewolfRunning, false, false, PhaseDay)
	phase := func(game WerewolfGame, actorID int64, phase WerewolfPhase) error {
		_, err := game.CheckPhase(actorID, phase)
		return err
	}
	jester := []WerewolfRoleInput{{ID: 103, Name: text("Fool")}}
	for _, tc := range []struct {
		name string
		got  error
		want error
	}{
		{"join the lobby", lobby.CheckJoin(outsiderID), nil},
		{"join twice", lobby.CheckJoin(adaID), nil},
		{"the party's host joins like anyone", lobby.CheckJoin(hostID), nil},
		{"the game master does not play", lobby.CheckJoin(masterID), ErrActivityConflict},
		{"join a running game", running.CheckJoin(outsiderID), ErrActivityConflict},
		{"join a full game", full.CheckJoin(outsiderID), ErrWerewolfPlayerLimit},
		{"a seated player joins a full game again", full.CheckJoin(adaID), nil},
		{"leave the lobby", lobby.CheckLeave(), nil},
		{"leave a running game", running.CheckLeave(), ErrActivityConflict},

		{"a player commands", lobby.CheckGameMaster(adaID), ErrGameMasterRequired},
		{"the party's host commands", lobby.CheckGameMaster(hostID), ErrGameMasterRequired},
		{"nobody commands a game without a game master", withoutMaster.CheckGameMaster(0), ErrGameMasterRequired},
		{"the game master commands", finished.CheckGameMaster(masterID), nil},

		{"edit roles", lobby.CheckRoles(masterID, 4, jester), nil},
		{"edit roles as a player", lobby.CheckRoles(adaID, 4, jester), ErrGameMasterRequired},
		{"edit roles with a stale revision", lobby.CheckRoles(masterID, 3, jester), ErrActivityConflict},
		{"edit roles of a running game", running.CheckRoles(masterID, 4, jester), ErrActivityConflict},
		{"keep a role of another game", lobby.CheckRoles(masterID, 4, []WerewolfRoleInput{{ID: 999, Name: text("Fool")}}), ErrInvalidWerewolfRoles},
		{"turn a custom role into a built-in one", lobby.CheckRoles(masterID, 4, []WerewolfRoleInput{{ID: 103, Key: text(RoleHunter)}}), ErrInvalidWerewolfRoles},
		{"turn a built-in role into another", lobby.CheckRoles(masterID, 4, []WerewolfRoleInput{{ID: 101, Key: text(RoleHunter)}}), ErrInvalidWerewolfRoles},

		{"start", lobby.CheckAction(masterID, WerewolfStart, 4), nil},
		{"start as the party's host", lobby.CheckAction(hostID, WerewolfStart, 4), ErrGameMasterRequired},
		{"start with a stale revision", lobby.CheckAction(masterID, WerewolfStart, 5), ErrActivityConflict},
		{"start twice", running.CheckAction(masterID, WerewolfStart, 4), ErrActivityConflict},
		{"finish", running.CheckAction(masterID, WerewolfFinish, 4), nil},
		{"finish the lobby", lobby.CheckAction(masterID, WerewolfFinish, 4), ErrActivityConflict},
		{"reset", finished.CheckAction(masterID, WerewolfReset, 4), nil},
		{"reset a running game", running.CheckAction(masterID, WerewolfReset, 4), ErrActivityConflict},
		{"unknown action", lobby.CheckAction(masterID, "pause", 4), ErrActivityConflict},

		{"remove a player", lobby.CheckRemoval(masterID), nil},
		{"remove a player as a player", lobby.CheckRemoval(adaID), ErrGameMasterRequired},
		{"remove a player from a running game", running.CheckRemoval(masterID), ErrActivityConflict},

		{"kill a player", running.CheckLife(masterID, cleoID), nil},
		{"kill as a player", running.CheckLife(adaID, cleoID), ErrGameMasterRequired},
		{"kill in the lobby", lobby.CheckLife(masterID, cleoID), ErrActivityConflict},
		{"kill someone who is not playing", running.CheckLife(masterID, outsiderID), ErrInvalidWerewolfPlayer},

		{"name a mayor", running.CheckMayor(masterID, &[]int64{cleoID}[0]), nil},
		{"name nobody", running.CheckMayor(masterID, nil), nil},
		{"name a mayor as the mayor", running.CheckMayor(adaID, nil), ErrGameMasterRequired},
		{"name a dead mayor", running.CheckMayor(masterID, &[]int64{benID}[0]), ErrActivityConflict},
		{"name a mayor who is not playing", running.CheckMayor(masterID, &[]int64{outsiderID}[0]), ErrInvalidWerewolfPlayer},
		{"name a mayor in the lobby", lobby.CheckMayor(masterID, nil), ErrActivityConflict},

		{"switch to day", phase(running, masterID, PhaseDay), nil},
		{"switch phase as a player", phase(running, benID, PhaseDay), ErrGameMasterRequired},
		{"switch phase without the variant", phase(withoutGhosts, masterID, PhaseNight), nil},
		{"switch phase after the end", phase(finished, masterID, PhaseNight), ErrActivityConflict},
		{"unknown phase", phase(running, masterID, "dusk"), ErrActivityConflict},

		{"a ghost writes by night", running.CheckMessage(benID), nil},
		{"a living player writes", running.CheckMessage(cleoID), ErrWerewolfMessageForbidden},
		{"the game master writes", running.CheckMessage(masterID), ErrWerewolfMessageForbidden},
		{"an outsider writes", running.CheckMessage(outsiderID), ErrWerewolfMessageForbidden},
		{"a ghost writes by day", day.CheckMessage(benID), ErrWerewolfMessageForbidden},
		{"a ghost writes without the variant", withoutGhosts.CheckMessage(benID), ErrWerewolfMessageForbidden},
		{"a ghost writes after the end", werewolfFixture(WerewolfFinished, false, true, PhaseNight).CheckMessage(benID), ErrWerewolfMessageForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %v, want %v", tc.got, tc.want)
			}
		})
	}
	if changed, err := running.CheckPhase(masterID, PhaseNight); err != nil || changed {
		t.Fatalf("repeating the current phase: changed=%t err=%v", changed, err)
	}
	if changed, err := running.CheckPhase(masterID, PhaseDay); err != nil || !changed {
		t.Fatalf("switching to day: changed=%t err=%v", changed, err)
	}
}

func TestWerewolfEventSettingsAndSummary(t *testing.T) {
	master, other := int64(7), int64(8)
	for _, tc := range []struct {
		name  string
		input Input
		want  error
	}{
		{"werewolf without settings", Input{Type: TypeWerewolf, Title: "Night falls"}, nil},
		{"werewolf without a game master", Input{Type: TypeWerewolf, Title: "Night falls", Werewolf: &WerewolfInput{}}, nil},
		{"werewolf with a game master", Input{Type: TypeWerewolf, Title: "Night falls", Werewolf: &WerewolfInput{GameMasterID: &master}}, nil},
		{"update that omits the type", Input{Title: "Night falls", Werewolf: &WerewolfInput{GameMasterID: &master}}, nil},
		{"game master that is not an ID", Input{Type: TypeWerewolf, Title: "Night falls", Werewolf: &WerewolfInput{GameMasterID: new(int64)}}, ErrInvalidEvent},
		{"werewolf settings on an ordinary event", Input{Type: TypeEvent, Title: "Cake", Werewolf: &WerewolfInput{}}, ErrInvalidEvent},
		{"werewolf settings on a question round", Input{Type: TypeQuestions, Title: "No Filter", Werewolf: &WerewolfInput{}}, ErrInvalidEvent},
		{"vote settings on a werewolf event", Input{Type: TypeWerewolf, Title: "Night falls", Vote: &VoteInput{Question: "Who?", Choices: ChoicesCustom, Labels: []string{"A", "B"}}}, ErrInvalidEvent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tc.input.normalize(); err != tc.want {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}

	game := func(status WerewolfStatus) Event {
		return Event{Type: TypeWerewolf, Revision: 9, Werewolf: &WerewolfSummary{Status: status, GameMaster: &Person{ID: master}}}
	}
	for _, tc := range []struct {
		name  string
		event Event
		input Input
		want  error
	}{
		{"metadata only, without a revision", game(WerewolfRunning), Input{Title: "Renamed"}, nil},
		{"same game master while running", game(WerewolfRunning), Input{Werewolf: &WerewolfInput{GameMasterID: &master}}, nil},
		{"another game master while running", game(WerewolfRunning), Input{Werewolf: &WerewolfInput{GameMasterID: &other}}, ErrActivityConflict},
		{"no game master while running", game(WerewolfRunning), Input{Werewolf: &WerewolfInput{}}, ErrActivityConflict},
		{"another game master in the lobby", game(WerewolfLobby), Input{Werewolf: &WerewolfInput{GameMasterID: &other}}, nil},
		{"another game master once finished", game(WerewolfFinished), Input{Werewolf: &WerewolfInput{}}, nil},
		{"werewolf settings on a vote", Event{Type: TypeVote, Revision: 1, Vote: &Vote{}}, Input{Revision: 1, Werewolf: &WerewolfInput{}}, ErrActivityConflict},
		{"another type", game(WerewolfLobby), Input{Type: TypeVote}, ErrActivityConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.event.CheckEdit(tc.input); err != tc.want {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}

	now := time.Date(2026, 11, 14, 20, 0, 0, 0, time.UTC)
	unlock := now.Add(time.Minute).Format(time.RFC3339)
	event := game(WerewolfRunning)
	event.UnlockAt = &unlock
	if view := event.View(now, false); !view.Locked || view.Werewolf != nil {
		t.Fatalf("a locked game was shown to guests: %+v", view)
	}
	if event.View(now, true).Werewolf == nil || event.View(now.Add(time.Minute), false).Werewolf == nil {
		t.Fatal("the game stayed hidden from the host or after the unlock")
	}
}

// recordingWerewolf keeps what the service passes on. Its embedded port is
// nil: any command these tests do not expect would panic.
type recordingWerewolf struct {
	WerewolfRepository
	roles  []WerewolfRoleInput
	text   string
	writes int
}

func (repository *recordingWerewolf) SaveWerewolfRoles(_ context.Context, _ Actor, _, _ int64, roles []WerewolfRoleInput) (Werewolf, error) {
	repository.roles = roles
	repository.writes++
	return Werewolf{}, nil
}

func (repository *recordingWerewolf) WriteWerewolfMessage(_ context.Context, _ Actor, _ int64, text string) (Werewolf, error) {
	repository.text = text
	repository.writes++
	return Werewolf{}, nil
}

func TestWerewolfServiceValidatesBeforePersistence(t *testing.T) {
	repository := &recordingWerewolf{}
	service := NewWerewolf(repository)
	if _, err := service.SaveRoles(t.Context(), Actor{}, 7, 1, []WerewolfRoleInput{{Name: text("Jester")}}); !errors.Is(err, ErrInvalidWerewolfRoles) {
		t.Fatalf("roles without a villager: %v", err)
	}
	if _, err := service.WriteMessage(t.Context(), Actor{}, 7, strings.Repeat("é", 281)); !errors.Is(err, ErrInvalidWerewolfMessage) {
		t.Fatalf("message of 281 characters: %v", err)
	}
	if repository.writes != 0 {
		t.Fatal("invalid input reached the repository")
	}
	if _, err := service.SaveRoles(t.Context(), Actor{}, 7, 1, []WerewolfRoleInput{{Key: text(RoleVillager)}, {Name: text(" Jester ")}}); err != nil || *repository.roles[1].Name != "Jester" {
		t.Fatalf("roles were not normalized: %v %+v", err, repository.roles)
	}
	if _, err := service.WriteMessage(t.Context(), Actor{}, 7, "  "+strings.Repeat("é", 280)+"\n"); err != nil || repository.text != strings.Repeat("é", 280) {
		t.Fatalf("message was not trimmed: %v %q", err, repository.text)
	}
	if _, err := service.WriteMessage(t.Context(), Actor{}, 7, " \t"); err != nil || repository.text != "" {
		t.Fatalf("an empty message must reach the repository as a removal: %v %q", err, repository.text)
	}
}
