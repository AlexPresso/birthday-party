package app

import (
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/programme"
)

// Every werewolf route is open to any guest with full app access. The game
// decides who the game master is, so no route is reserved for the host, and
// each response is the game as its viewer may see it.

// werewolfInput reads the event ID and the JSON body of a command.
func werewolfInput(w http.ResponseWriter, r *http.Request, input any) (int64, bool) {
	id, ok := pathID(w, r)
	if !ok {
		return 0, false
	}
	return id, decode(w, r, input)
}

// answerWerewolf ends a command with the viewer's game and tells the other
// clients to fetch theirs.
func (a *App) answerWerewolf(w http.ResponseWriter, game programme.Werewolf, err error) {
	if err != nil {
		failError(w, err)
		return
	}
	a.programmeChanged()
	respond(w, http.StatusOK, game)
}

func (a *App) readWerewolf(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	game, err := a.werewolf.Read(r.Context(), programmeActor(viewer), id)
	if err != nil {
		failError(w, err)
		return
	}
	respond(w, http.StatusOK, game)
}

func (a *App) joinWerewolf(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct{}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.Join(r.Context(), programmeActor(viewer), id)
	a.answerWerewolf(w, game, err)
}

func (a *App) leaveWerewolf(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	game, err := a.werewolf.Leave(r.Context(), programmeActor(viewer), id)
	a.answerWerewolf(w, game, err)
}

func (a *App) saveWerewolfRoles(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Revision int64                         `json:"revision"`
		Roles    []programme.WerewolfRoleInput `json:"roles"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.SaveRoles(r.Context(), programmeActor(viewer), id, input.Revision, input.Roles)
	a.answerWerewolf(w, game, err)
}

func (a *App) setWerewolfVariants(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		HideRolesOfDead *bool `json:"hideRolesOfDead"`
		GhostMessages   *bool `json:"ghostMessages"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	if input.HideRolesOfDead == nil || input.GhostMessages == nil {
		fail(w, "invalid_body")
		return
	}
	game, err := a.werewolf.SetVariants(r.Context(), programmeActor(viewer), id, *input.HideRolesOfDead, *input.GhostMessages)
	a.answerWerewolf(w, game, err)
}

func (a *App) transitionWerewolf(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Revision int64                    `json:"revision"`
		Action   programme.WerewolfAction `json:"action"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.Transition(r.Context(), programmeActor(viewer), id, input.Action, input.Revision)
	a.answerWerewolf(w, game, err)
}

func (a *App) removeWerewolfPlayer(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	guestID, ok := pathValueID(w, r, "guestId")
	if !ok {
		return
	}
	game, err := a.werewolf.RemovePlayer(r.Context(), programmeActor(viewer), id, guestID)
	a.answerWerewolf(w, game, err)
}

func (a *App) setWerewolfLife(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	guestID, ok := pathValueID(w, r, "guestId")
	if !ok {
		return
	}
	var input struct {
		Alive *bool `json:"alive"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	if input.Alive == nil {
		fail(w, "invalid_body")
		return
	}
	game, err := a.werewolf.SetLife(r.Context(), programmeActor(viewer), id, guestID, *input.Alive)
	a.answerWerewolf(w, game, err)
}

// setWerewolfMayor names a living player mayor; a null guestId names nobody.
func (a *App) setWerewolfMayor(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		GuestID *int64 `json:"guestId"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.SetMayor(r.Context(), programmeActor(viewer), id, input.GuestID)
	a.answerWerewolf(w, game, err)
}

func (a *App) setWerewolfPhase(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Phase programme.WerewolfPhase `json:"phase"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.SetPhase(r.Context(), programmeActor(viewer), id, input.Phase)
	a.answerWerewolf(w, game, err)
}

// writeWerewolfMessage saves the viewer's ghost message; an empty text removes it.
func (a *App) writeWerewolfMessage(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	var input struct {
		Text string `json:"text"`
	}
	id, ok := werewolfInput(w, r, &input)
	if !ok {
		return
	}
	game, err := a.werewolf.WriteMessage(r.Context(), programmeActor(viewer), id, input.Text)
	a.answerWerewolf(w, game, err)
}
