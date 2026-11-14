package programme

import (
	"context"
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	WerewolfPlayerLimit = 60
	WerewolfRoleLimit   = 20
	// werewolfMinimumPlayers is the fewest players a game can start with.
	werewolfMinimumPlayers = 3
	roleNameLength         = 40
	roleDescriptionLength  = 600
	roleQuantityLimit      = 60
	ghostMessageLength     = 280
)

const (
	ErrGameMasterRequired       ActivityError = "game_master_required"
	ErrInvalidWerewolfRoles     ActivityError = "invalid_werewolf_roles"
	ErrWerewolfRolesMismatch    ActivityError = "werewolf_roles_mismatch"
	ErrWerewolfPlayerLimit      ActivityError = "werewolf_player_limit"
	ErrInvalidWerewolfPlayer    ActivityError = "invalid_werewolf_player"
	ErrWerewolfMessageForbidden ActivityError = "werewolf_message_forbidden"
	ErrInvalidWerewolfMessage   ActivityError = "invalid_werewolf_message"
)

// WerewolfStatus is the state of a game. The game master moves it with the
// start, finish and reset actions.
type WerewolfStatus string

const (
	WerewolfLobby    WerewolfStatus = "lobby"
	WerewolfRunning  WerewolfStatus = "running"
	WerewolfFinished WerewolfStatus = "finished"
)

// WerewolfAction is a game master's state command.
type WerewolfAction string

const (
	WerewolfStart  WerewolfAction = "start"
	WerewolfFinish WerewolfAction = "finish"
	WerewolfReset  WerewolfAction = "reset"
)

// werewolfTransitions names the only state each action can leave.
var werewolfTransitions = map[WerewolfAction]WerewolfStatus{
	WerewolfStart:  WerewolfLobby,
	WerewolfFinish: WerewolfRunning,
	WerewolfReset:  WerewolfFinished,
}

// WerewolfPhase only matters to the ghost messages variant: ghosts write by
// night and the mayor reads by day.
type WerewolfPhase string

const (
	PhaseDay   WerewolfPhase = "day"
	PhaseNight WerewolfPhase = "night"
)

// Keys of the built-in roles. The interface translates their names.
const (
	RoleWerewolf = "werewolf"
	RoleVillager = "villager"
	RoleSeer     = "seer"
	RoleWitch    = "witch"
	RoleHunter   = "hunter"
	RoleCupid    = "cupid"
	RoleGuard    = "guard"
)

// builtinRoles lists the built-in keys in the order a new game shows them.
var builtinRoles = []string{RoleWerewolf, RoleVillager, RoleSeer, RoleWitch, RoleHunter, RoleCupid, RoleGuard}

// Person is a guest as the board shows them.
type Person struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

// WerewolfSummary is what the programme shows of a game.
type WerewolfSummary struct {
	Status     WerewolfStatus `json:"status"`
	GameMaster *Person        `json:"gameMaster"`
	Players    int            `json:"players"`
}

// ChangesGameMaster reports whether the settings name another game master
// than the current one.
func (summary WerewolfSummary) ChangesGameMaster(input WerewolfInput) bool {
	if summary.GameMaster == nil || input.GameMasterID == nil {
		return summary.GameMaster != nil || input.GameMasterID != nil
	}
	return summary.GameMaster.ID != *input.GameMasterID
}

// WerewolfInput is the host's setting of a werewolf event: the guest who
// leads the game, or nil while undecided.
type WerewolfInput struct {
	GameMasterID *int64 `json:"gameMasterId"`
}

// RoleCard is a role as a player reads it. A built-in role has a key and no
// name; its description is nil until the game master rewrites it. A custom
// role has no key and carries its own name.
type RoleCard struct {
	Key         *string `json:"key"`
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

// WerewolfRole is an entry of the game master's role list.
type WerewolfRole struct {
	RoleCard
	ID    int64 `json:"id"`
	Count int   `json:"count"`
}

// WerewolfRoleInput is a role as the game master saves it. A zero ID adds a
// role; any other keeps the role that carries it.
type WerewolfRoleInput struct {
	ID          int64   `json:"id"`
	Key         *string `json:"key"`
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Count       int     `json:"count"`
}

// DefaultWerewolfRoles is the list of a new game: every built-in role, with
// one werewolf and nothing else yet.
func DefaultWerewolfRoles() []WerewolfRoleInput {
	roles := make([]WerewolfRoleInput, len(builtinRoles))
	for i, key := range builtinRoles {
		roles[i] = WerewolfRoleInput{Key: &key}
	}
	roles[0].Count = 1
	return roles
}

// normalizeWerewolfRoles trims the authored texts and applies the limits. An
// empty description is stored as none.
func normalizeWerewolfRoles(roles []WerewolfRoleInput) ([]WerewolfRoleInput, error) {
	if len(roles) == 0 || len(roles) > WerewolfRoleLimit {
		return nil, ErrInvalidWerewolfRoles
	}
	normalized := make([]WerewolfRoleInput, 0, len(roles))
	ids, keys := map[int64]bool{}, map[string]bool{}
	for _, role := range roles {
		if role.ID < 0 || ids[role.ID] || role.Count < 0 || role.Count > roleQuantityLimit {
			return nil, ErrInvalidWerewolfRoles
		}
		ids[role.ID] = role.ID != 0
		if role.Key != nil {
			if !slices.Contains(builtinRoles, *role.Key) || keys[*role.Key] || role.Name != nil {
				return nil, ErrInvalidWerewolfRoles
			}
			keys[*role.Key] = true
		} else {
			if role.Name == nil {
				return nil, ErrInvalidWerewolfRoles
			}
			name := strings.TrimSpace(*role.Name)
			if name == "" || utf8.RuneCountInString(name) > roleNameLength {
				return nil, ErrInvalidWerewolfRoles
			}
			role.Name = &name
		}
		if role.Description != nil {
			description := strings.TrimSpace(*role.Description)
			if utf8.RuneCountInString(description) > roleDescriptionLength {
				return nil, ErrInvalidWerewolfRoles
			}
			role.Description = &description
			if description == "" {
				role.Description = nil
			}
		}
		normalized = append(normalized, role)
	}
	if !keys[RoleVillager] {
		return nil, ErrInvalidWerewolfRoles
	}
	return normalized, nil
}

// DealWerewolfRoles gives each player one role at random. It refuses to deal
// unless there are enough players and exactly one card per player.
func DealWerewolfRoles(playerIDs []int64, roles []WerewolfRole, random *rand.Rand) (map[int64]int64, error) {
	deck := make([]int64, 0, len(playerIDs))
	for _, role := range roles {
		for range role.Count {
			deck = append(deck, role.ID)
		}
	}
	if len(playerIDs) < werewolfMinimumPlayers || len(deck) != len(playerIDs) {
		return nil, ErrWerewolfRolesMismatch
	}
	random.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
	dealt := make(map[int64]int64, len(playerIDs))
	for i, playerID := range playerIDs {
		dealt[playerID] = deck[i]
	}
	return dealt, nil
}

// WerewolfSeat is a player with the role they were dealt. RoleID is zero in
// the lobby.
type WerewolfSeat struct {
	Person
	Alive  bool
	Mayor  bool
	RoleID int64
}

// GhostMessage is what a dead player wrote for the mayor during the night.
type GhostMessage struct {
	AuthorID  int64
	Text      string
	Delivered bool
}

// WerewolfGame is the complete state of a game, every secret included. Only
// View turns it into something a client may receive.
type WerewolfGame struct {
	Status          WerewolfStatus
	Revision        int64
	GameMaster      *Person
	HideRolesOfDead bool
	GhostMessages   bool
	Phase           WerewolfPhase
	Roles           []WerewolfRole
	// Players are in join order.
	Players  []WerewolfSeat
	Messages []GhostMessage
}

// MarshalJSON keeps the complete state out of any response by mistake.
func (WerewolfGame) MarshalJSON() ([]byte, error) {
	return nil, errors.New("programme: a werewolf game is only serialized through View")
}

// WerewolfPlayer is a player on the board. Role is nil whenever the viewer
// may not see it.
type WerewolfPlayer struct {
	Person
	Alive bool      `json:"alive"`
	Mayor bool      `json:"mayor"`
	Role  *RoleCard `json:"role"`
}

// MayorMessage is the ghost message drawn for the mayor.
type MayorMessage struct {
	From Person `json:"from"`
	Text string `json:"text"`
}

// WerewolfMessage is a ghost message as the game master sees it.
type WerewolfMessage struct {
	From      Person `json:"from"`
	Text      string `json:"text"`
	Delivered bool   `json:"delivered"`
}

// Werewolf is a game as one viewer sees it.
type Werewolf struct {
	Status          WerewolfStatus   `json:"status"`
	Revision        int64            `json:"revision"`
	GameMaster      *Person          `json:"gameMaster"`
	IsGameMaster    bool             `json:"isGameMaster"`
	Joined          bool             `json:"joined"`
	HideRolesOfDead bool             `json:"hideRolesOfDead"`
	GhostMessages   bool             `json:"ghostMessages"`
	Phase           WerewolfPhase    `json:"phase"`
	Players         []WerewolfPlayer `json:"players"`
	MyRole          *RoleCard        `json:"myRole"`
	CanWriteMessage bool             `json:"canWriteMessage"`
	MyMessage       *string          `json:"myMessage"`
	MayorMessage    *MayorMessage    `json:"mayorMessage"`
	// Roles and Messages are nil for everyone but the game master.
	Roles    []WerewolfRole    `json:"roles"`
	Messages []WerewolfMessage `json:"messages"`
}

// View builds the game for one viewer. It is the only place that decides who
// sees which role and which message:
//
//   - the game master sees every role, the role list and every ghost message;
//   - a player sees their own role once the game runs;
//   - everyone sees a dead player's role unless secret deaths are on, and
//     every role once the game is finished;
//   - a ghost sees their own message, and the mayor the one drawn, by day,
//     while the game runs with the ghost variant.
//
// The viewer is identified by their guest ID alone, so being the party's
// host changes nothing.
func (game WerewolfGame) View(viewerID int64) Werewolf {
	master := game.isGameMaster(viewerID)
	running := game.Status == WerewolfRunning
	view := Werewolf{
		Status: game.Status, Revision: game.Revision, GameMaster: game.GameMaster, IsGameMaster: master,
		HideRolesOfDead: game.HideRolesOfDead, GhostMessages: game.GhostMessages, Phase: game.Phase,
		Players: make([]WerewolfPlayer, 0, len(game.Players)),
	}
	cards := make(map[int64]*RoleCard, len(game.Roles))
	for _, role := range game.Roles {
		cards[role.ID] = &role.RoleCard
	}
	people := make(map[int64]Person, len(game.Players))
	var viewer WerewolfSeat
	for _, seat := range game.Players {
		own := seat.ID == viewerID
		player := WerewolfPlayer{Person: seat.Person, Alive: seat.Alive, Mayor: seat.Mayor}
		if game.Status == WerewolfFinished || running && (master || own || !seat.Alive && !game.HideRolesOfDead) {
			player.Role = cards[seat.RoleID]
		}
		if own {
			viewer, view.Joined, view.MyRole = seat, true, player.Role
		}
		people[seat.ID] = seat.Person
		view.Players = append(view.Players, player)
	}
	if master {
		view.Roles = append([]WerewolfRole{}, game.Roles...)
		view.Messages = make([]WerewolfMessage, 0, len(game.Messages))
	}
	ghosts := running && game.GhostMessages
	view.CanWriteMessage = ghosts && game.Phase == PhaseNight && view.Joined && !viewer.Alive
	for _, message := range game.Messages {
		from := people[message.AuthorID]
		if master {
			view.Messages = append(view.Messages, WerewolfMessage{From: from, Text: message.Text, Delivered: message.Delivered})
		}
		if !ghosts {
			continue
		}
		if message.AuthorID == viewerID {
			view.MyMessage = &message.Text
		}
		if message.Delivered && game.Phase == PhaseDay && viewer.Mayor {
			view.MayorMessage = &MayorMessage{From: from, Text: message.Text}
		}
	}
	return view
}

func (game WerewolfGame) isGameMaster(guestID int64) bool {
	return game.GameMaster != nil && game.GameMaster.ID == guestID
}

func (game WerewolfGame) seat(guestID int64) (WerewolfSeat, bool) {
	for _, seat := range game.Players {
		if seat.ID == guestID {
			return seat, true
		}
	}
	return WerewolfSeat{}, false
}

// CheckGameMaster refuses anyone but the game master, whatever their role at
// the party.
func (game WerewolfGame) CheckGameMaster(actorID int64) error {
	if !game.isGameMaster(actorID) {
		return ErrGameMasterRequired
	}
	return nil
}

// checkCommand is CheckGameMaster for a command that needs one state.
func (game WerewolfGame) checkCommand(actorID int64, status WerewolfStatus) error {
	if err := game.CheckGameMaster(actorID); err != nil {
		return err
	}
	if game.Status != status {
		return ErrActivityConflict
	}
	return nil
}

// CheckJoin lets a guest take a seat in the lobby. Joining twice is allowed
// and changes nothing; the game master does not play.
func (game WerewolfGame) CheckJoin(actorID int64) error {
	if game.Status != WerewolfLobby || game.isGameMaster(actorID) {
		return ErrActivityConflict
	}
	if _, joined := game.seat(actorID); !joined && len(game.Players) >= WerewolfPlayerLimit {
		return ErrWerewolfPlayerLimit
	}
	return nil
}

// CheckLeave lets a player give their seat back while the game is in the lobby.
func (game WerewolfGame) CheckLeave() error {
	if game.Status != WerewolfLobby {
		return ErrActivityConflict
	}
	return nil
}

// CheckRoles decides whether the game master may replace the role list. A
// role sent with an ID must be a role of this game and keep its kind.
func (game WerewolfGame) CheckRoles(actorID, revision int64, roles []WerewolfRoleInput) error {
	if err := game.CheckGameMaster(actorID); err != nil {
		return err
	}
	if revision != game.Revision || game.Status != WerewolfLobby {
		return ErrActivityConflict
	}
	for _, role := range roles {
		if role.ID == 0 {
			continue
		}
		kept := slices.ContainsFunc(game.Roles, func(current WerewolfRole) bool {
			return current.ID == role.ID && sameKey(current.Key, role.Key)
		})
		if !kept {
			return ErrInvalidWerewolfRoles
		}
	}
	return nil
}

func sameKey(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// CheckAction decides whether the game master may start, finish or reset the
// game. Starting has one more condition, which DealWerewolfRoles checks.
func (game WerewolfGame) CheckAction(actorID int64, action WerewolfAction, revision int64) error {
	if err := game.CheckGameMaster(actorID); err != nil {
		return err
	}
	if from, known := werewolfTransitions[action]; !known || from != game.Status || revision != game.Revision {
		return ErrActivityConflict
	}
	return nil
}

// CheckRemoval lets the game master take a player out of the lobby.
func (game WerewolfGame) CheckRemoval(actorID int64) error {
	return game.checkCommand(actorID, WerewolfLobby)
}

// CheckLife lets the game master mark a player dead or alive again.
func (game WerewolfGame) CheckLife(actorID, guestID int64) error {
	if err := game.checkCommand(actorID, WerewolfRunning); err != nil {
		return err
	}
	if _, playing := game.seat(guestID); !playing {
		return ErrInvalidWerewolfPlayer
	}
	return nil
}

// CheckMayor lets the game master name a living player mayor, or nobody.
func (game WerewolfGame) CheckMayor(actorID int64, guestID *int64) error {
	if err := game.checkCommand(actorID, WerewolfRunning); err != nil {
		return err
	}
	if guestID == nil {
		return nil
	}
	seat, playing := game.seat(*guestID)
	if !playing {
		return ErrInvalidWerewolfPlayer
	}
	if !seat.Alive {
		return ErrActivityConflict
	}
	return nil
}

// CheckPhase lets the game master switch between day and night in the ghost
// variant. It reports false when the game is already in that phase, which
// must then change nothing: a repeated command would draw or clear again.
func (game WerewolfGame) CheckPhase(actorID int64, phase WerewolfPhase) (bool, error) {
	if err := game.checkCommand(actorID, WerewolfRunning); err != nil {
		return false, err
	}
	if !game.GhostMessages || phase != PhaseDay && phase != PhaseNight {
		return false, ErrActivityConflict
	}
	return phase != game.Phase, nil
}

// CheckMessage lets a dead player write, replace or remove their message
// during the night.
func (game WerewolfGame) CheckMessage(actorID int64) error {
	seat, playing := game.seat(actorID)
	if game.Status != WerewolfRunning || !game.GhostMessages || game.Phase != PhaseNight || !playing || seat.Alive {
		return ErrWerewolfMessageForbidden
	}
	return nil
}

// DrawMessage picks the message the mayor receives when the day comes: one
// of the night's messages, each as likely as the others. With no mayor or no
// message, nothing is delivered.
func (game WerewolfGame) DrawMessage(random *rand.Rand) (authorID int64, delivered bool) {
	hasMayor := slices.ContainsFunc(game.Players, func(seat WerewolfSeat) bool { return seat.Mayor })
	if !hasMayor || len(game.Messages) == 0 {
		return 0, false
	}
	return game.Messages[random.IntN(len(game.Messages))].AuthorID, true
}

// WerewolfRepository owns each command as one transaction: it rechecks the
// actor's access, locks the game, applies the rules above to the locked state
// and returns the actor's view.
type WerewolfRepository interface {
	ReadWerewolf(ctx context.Context, actor Actor, eventID int64) (Werewolf, error)
	JoinWerewolf(ctx context.Context, actor Actor, eventID int64) (Werewolf, error)
	LeaveWerewolf(ctx context.Context, actor Actor, eventID int64) (Werewolf, error)
	SaveWerewolfRoles(ctx context.Context, actor Actor, eventID, revision int64, roles []WerewolfRoleInput) (Werewolf, error)
	SetWerewolfVariants(ctx context.Context, actor Actor, eventID int64, hideRolesOfDead, ghostMessages bool) (Werewolf, error)
	TransitionWerewolf(ctx context.Context, actor Actor, eventID int64, action WerewolfAction, revision int64) (Werewolf, error)
	RemoveWerewolfPlayer(ctx context.Context, actor Actor, eventID, guestID int64) (Werewolf, error)
	SetWerewolfLife(ctx context.Context, actor Actor, eventID, guestID int64, alive bool) (Werewolf, error)
	SetWerewolfMayor(ctx context.Context, actor Actor, eventID int64, guestID *int64) (Werewolf, error)
	SetWerewolfPhase(ctx context.Context, actor Actor, eventID int64, phase WerewolfPhase) (Werewolf, error)
	// WriteWerewolfMessage saves the actor's ghost message; an empty text removes it.
	WriteWerewolfMessage(ctx context.Context, actor Actor, eventID int64, text string) (Werewolf, error)
}

// WerewolfService validates what guests and the game master send before the
// repository applies it.
type WerewolfService struct{ repository WerewolfRepository }

func NewWerewolf(repository WerewolfRepository) *WerewolfService {
	return &WerewolfService{repository: repository}
}

func (s *WerewolfService) Read(ctx context.Context, actor Actor, eventID int64) (Werewolf, error) {
	return s.repository.ReadWerewolf(ctx, actor, eventID)
}

func (s *WerewolfService) Join(ctx context.Context, actor Actor, eventID int64) (Werewolf, error) {
	return s.repository.JoinWerewolf(ctx, actor, eventID)
}

func (s *WerewolfService) Leave(ctx context.Context, actor Actor, eventID int64) (Werewolf, error) {
	return s.repository.LeaveWerewolf(ctx, actor, eventID)
}

// SaveRoles replaces the role list, in the order given.
func (s *WerewolfService) SaveRoles(ctx context.Context, actor Actor, eventID, revision int64, roles []WerewolfRoleInput) (Werewolf, error) {
	roles, err := normalizeWerewolfRoles(roles)
	if err != nil {
		return Werewolf{}, err
	}
	return s.repository.SaveWerewolfRoles(ctx, actor, eventID, revision, roles)
}

func (s *WerewolfService) SetVariants(ctx context.Context, actor Actor, eventID int64, hideRolesOfDead, ghostMessages bool) (Werewolf, error) {
	return s.repository.SetWerewolfVariants(ctx, actor, eventID, hideRolesOfDead, ghostMessages)
}

func (s *WerewolfService) Transition(ctx context.Context, actor Actor, eventID int64, action WerewolfAction, revision int64) (Werewolf, error) {
	return s.repository.TransitionWerewolf(ctx, actor, eventID, action, revision)
}

func (s *WerewolfService) RemovePlayer(ctx context.Context, actor Actor, eventID, guestID int64) (Werewolf, error) {
	return s.repository.RemoveWerewolfPlayer(ctx, actor, eventID, guestID)
}

func (s *WerewolfService) SetLife(ctx context.Context, actor Actor, eventID, guestID int64, alive bool) (Werewolf, error) {
	return s.repository.SetWerewolfLife(ctx, actor, eventID, guestID, alive)
}

func (s *WerewolfService) SetMayor(ctx context.Context, actor Actor, eventID int64, guestID *int64) (Werewolf, error) {
	return s.repository.SetWerewolfMayor(ctx, actor, eventID, guestID)
}

func (s *WerewolfService) SetPhase(ctx context.Context, actor Actor, eventID int64, phase WerewolfPhase) (Werewolf, error) {
	return s.repository.SetWerewolfPhase(ctx, actor, eventID, phase)
}

// WriteMessage saves the actor's message for the mayor. An empty text removes it.
func (s *WerewolfService) WriteMessage(ctx context.Context, actor Actor, eventID int64, text string) (Werewolf, error) {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > ghostMessageLength {
		return Werewolf{}, ErrInvalidWerewolfMessage
	}
	return s.repository.WriteWerewolfMessage(ctx, actor, eventID, text)
}
