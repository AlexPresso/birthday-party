package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

const welcomeSelect = "SELECT is_open,revision,current_step,required,generation,steps FROM welcome WHERE id=1"

// These expressions use welcome w and guest_welcome_progress p. Missing progress
// after opening belongs to a late arrival; existing participants finish explicitly.
const welcomeAccessSQL = `(w.is_open AND (w.generation=0 OR
 COALESCE(p.generation=w.generation AND p.completed,false) OR
 (NOT w.required AND (p.guest_id IS NULL OR p.generation<>w.generation))))`

const welcomePositionSQL = `(p.generation=w.generation AND NOT p.completed
 AND p.position>0 AND p.position<=w.current_step)`

type welcomeProgress struct {
	Generation int64
	Position   int
	Revision   int64
	Completed  bool
}

func welcomeHasAccess(state welcomeState, progress welcomeProgress) bool {
	if !state.Open {
		return false
	}
	if state.Generation == 0 {
		return true
	}
	if progress.Generation != state.Generation {
		return !state.Required
	}
	return progress.Completed
}

func guestWelcomeView(state welcomeState, progress welcomeProgress) welcomeView {
	view := welcomeView{Open: welcomeHasAccess(state, progress), Revision: state.Revision, ProgressRevision: progress.Revision}
	if view.Open || progress.Generation != state.Generation {
		return view
	}
	if progress.Position > 0 && progress.Position <= state.CurrentStep {
		view.Step = &visibleWelcomeStep{Position: progress.Position, Widgets: state.Steps[progress.Position-1].Widgets}
	}
	view.CanPrevious = progress.Position > 1
	view.CanNext = progress.Position < state.CurrentStep
	view.CanFinish = state.Open && (!state.Required || progress.Position == len(state.Steps))
	return view
}

func readWelcomeProgress(ctx context.Context, tx *sql.Tx, guestID int64, lock string) (welcomeProgress, error) {
	var progress welcomeProgress
	err := tx.QueryRowContext(ctx, "SELECT generation,position,revision,completed FROM guest_welcome_progress WHERE guest_id=$1"+lock, guestID).
		Scan(&progress.Generation, &progress.Position, &progress.Revision, &progress.Completed)
	if errors.Is(err, sql.ErrNoRows) {
		return progress, nil
	}
	return progress, err
}

func ensureWelcomeProgress(ctx context.Context, tx *sql.Tx, state welcomeState, guestID int64) (welcomeProgress, error) {
	if state.Generation == 0 {
		return welcomeProgress{}, nil
	}
	position := state.CurrentStep
	if state.Required && position > 0 {
		position = 1
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO guest_welcome_progress(guest_id,generation,position,completed)
 VALUES($1,$2,$3,$4) ON CONFLICT(guest_id) DO UPDATE
 SET generation=excluded.generation,position=excluded.position,completed=excluded.completed,
 revision=nextval('welcome_progress_revision_seq')
 WHERE guest_welcome_progress.generation<>excluded.generation`, guestID, state.Generation, position, state.Open && !state.Required)
	if err != nil {
		return welcomeProgress{}, err
	}
	return readWelcomeProgress(ctx, tx, guestID, " FOR UPDATE")
}

func (a *App) getWelcome(w http.ResponseWriter, r *http.Request, guest Guest) {
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	// Enrollment's foreign key locks the guest. Take that lock first, matching
	// media acceptance, so a queued host update cannot reverse the lock order.
	var guestID int64
	if err = tx.QueryRowContext(r.Context(), "SELECT id FROM guests WHERE id=$1 FOR KEY SHARE", guest.ID).Scan(&guestID); err != nil {
		internal(w, err)
		return
	}
	state, err := scanWelcome(tx.QueryRowContext(r.Context(), welcomeSelect+" FOR SHARE"))
	if err != nil {
		internal(w, err)
		return
	}
	progress, err := ensureWelcomeProgress(r.Context(), tx, state, guest.ID)
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, guestWelcomeView(state, progress))
}

func (a *App) transitionGuestWelcome(w http.ResponseWriter, r *http.Request, guest Guest) {
	var input struct {
		Revision *int64 `json:"revision"`
		Action   string `json:"action"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 {
		fail(w, 400, "invalid_body")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	state, err := scanWelcome(tx.QueryRowContext(r.Context(), welcomeSelect+" FOR SHARE"))
	if err != nil {
		internal(w, err)
		return
	}
	progress, err := readWelcomeProgress(r.Context(), tx, guest.ID, " FOR UPDATE")
	if err != nil {
		internal(w, err)
		return
	}
	if progress.Generation != state.Generation || progress.Revision != *input.Revision {
		fail(w, 409, "welcome_conflict")
		return
	}
	view := guestWelcomeView(state, progress)
	switch {
	case input.Action == "previous" && view.CanPrevious:
		progress.Position--
	case input.Action == "next" && view.CanNext:
		progress.Position++
	case input.Action == "finish" && view.CanFinish:
		progress.Completed = true
	default:
		fail(w, 409, "invalid_welcome_transition")
		return
	}
	err = tx.QueryRowContext(r.Context(), `UPDATE guest_welcome_progress
 SET position=$1,completed=$2,revision=nextval('welcome_progress_revision_seq')
 WHERE guest_id=$3 RETURNING revision`, progress.Position, progress.Completed, guest.ID).Scan(&progress.Revision)
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	a.realtime.notify(guest.ID, realtimeWelcome)
	respond(w, 200, guestWelcomeView(state, progress))
}

func (a *App) updateWelcomeRequired(w http.ResponseWriter, r *http.Request, _ Guest) {
	var input struct {
		Revision *int64 `json:"revision"`
		Required *bool  `json:"required"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Required == nil {
		fail(w, 400, "invalid_body")
		return
	}
	tx, state, err := a.lockWelcome(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	if state.Revision != *input.Revision {
		fail(w, 409, "welcome_conflict")
		return
	}
	state.Required = *input.Required
	if err = a.saveWelcome(r.Context(), tx, &state); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, state)
}

// Lock the shared sequence before progress, matching guest navigation. Callers
// receiving media already hold the guest/session locks before entering here.
func currentGuestWelcome(ctx context.Context, tx *sql.Tx, guestID int64) (welcomeView, error) {
	state, err := scanWelcome(tx.QueryRowContext(ctx, welcomeSelect+" FOR SHARE"))
	if err != nil {
		return welcomeView{}, err
	}
	progress, err := readWelcomeProgress(ctx, tx, guestID, " FOR SHARE")
	if err != nil {
		return welcomeView{}, err
	}
	return guestWelcomeView(state, progress), nil
}
