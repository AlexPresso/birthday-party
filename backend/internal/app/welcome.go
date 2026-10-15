package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

type welcomeStep struct {
	Title       string              `json:"title"`
	Body        string              `json:"body"`
	Action      *string             `json:"action"`
	MediaUpload *welcomeMediaUpload `json:"mediaUpload,omitempty"`
}

type welcomeMediaUpload struct {
	CategoryID *int64 `json:"categoryId"`
}

func (m *welcomeMediaUpload) UnmarshalJSON(data []byte) error {
	var input struct {
		CategoryID json.RawMessage `json:"categoryId"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return err
	}
	if len(input.CategoryID) == 0 {
		return errors.New("media upload categoryId is required")
	}
	return json.Unmarshal(input.CategoryID, &m.CategoryID)
}

type welcomeState struct {
	Open        bool          `json:"open"`
	Revision    int64         `json:"revision"`
	CurrentStep int           `json:"currentStep"`
	Steps       []welcomeStep `json:"steps"`
}

type welcomeView struct {
	Open     bool                `json:"open"`
	Revision int64               `json:"revision"`
	Step     *visibleWelcomeStep `json:"step"`
}

type visibleWelcomeStep struct {
	Position    int                 `json:"position"`
	Title       string              `json:"title"`
	Body        string              `json:"body"`
	Action      *string             `json:"action"`
	MediaUpload *welcomeMediaUpload `json:"mediaUpload,omitempty"`
}

func (a *App) getWelcome(w http.ResponseWriter, r *http.Request, _ Guest) {
	var view welcomeView
	var position int
	var current []byte
	// Select only the current step: future instructions never enter a guest response.
	err := a.db.QueryRowContext(r.Context(), `SELECT is_open,revision,current_step,
 CASE WHEN NOT is_open AND current_step>0 THEN steps->(current_step-1) END
 FROM welcome WHERE id=1`).Scan(&view.Open, &view.Revision, &position, &current)
	if err != nil {
		internal(w, err)
		return
	}
	if !view.Open && position > 0 && len(current) > 0 {
		var step welcomeStep
		if err := json.Unmarshal(current, &step); err != nil {
			internal(w, err)
			return
		}
		view.Step = &visibleWelcomeStep{Position: position, Title: step.Title, Body: step.Body, Action: step.Action, MediaUpload: step.MediaUpload}
	}
	respond(w, 200, view)
}

func (a *App) getAdminWelcome(w http.ResponseWriter, r *http.Request, _ Guest) {
	state, err := scanWelcome(a.db.QueryRowContext(r.Context(), "SELECT is_open,revision,current_step,steps FROM welcome WHERE id=1"))
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, state)
}

func scanWelcome(row *sql.Row) (welcomeState, error) {
	var state welcomeState
	var steps []byte
	if err := row.Scan(&state.Open, &state.Revision, &state.CurrentStep, &steps); err != nil {
		return state, err
	}
	err := json.Unmarshal(steps, &state.Steps)
	return state, err
}

func (a *App) lockWelcome(ctx context.Context) (*sql.Tx, welcomeState, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, welcomeState{}, err
	}
	state, err := scanWelcome(tx.QueryRowContext(ctx, "SELECT is_open,revision,current_step,steps FROM welcome WHERE id=1 FOR UPDATE"))
	if err != nil {
		tx.Rollback()
		return nil, state, err
	}
	return tx, state, nil
}

func (a *App) updateWelcome(w http.ResponseWriter, r *http.Request, _ Guest) {
	var input struct {
		Revision *int64        `json:"revision"`
		Steps    []welcomeStep `json:"steps"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Steps == nil || len(input.Steps) > 12 {
		fail(w, 400, "invalid_welcome_steps")
		return
	}
	for i := range input.Steps {
		step := &input.Steps[i]
		step.Title = strings.TrimSpace(step.Title)
		step.Body = strings.TrimSpace(step.Body)
		if step.Title == "" || utf8.RuneCountInString(step.Title) > 120 || utf8.RuneCountInString(step.Body) > 1000 {
			fail(w, 400, "invalid_welcome_steps")
			return
		}
		if step.Action != nil && *step.Action != "profile_photo" && *step.Action != "media_upload" {
			fail(w, 400, "invalid_welcome_action")
			return
		}
		media := step.Action != nil && *step.Action == "media_upload"
		if media != (step.MediaUpload != nil) || step.MediaUpload != nil && step.MediaUpload.CategoryID != nil && *step.MediaUpload.CategoryID < 1 {
			fail(w, 400, "invalid_welcome_action")
			return
		}
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
	if !state.Open && state.CurrentStep > 0 {
		fail(w, 409, "welcome_steps_locked")
		return
	}
	for _, step := range input.Steps {
		if step.MediaUpload == nil || step.MediaUpload.CategoryID == nil {
			continue
		}
		var id int64
		err := tx.QueryRowContext(r.Context(), "SELECT id FROM media_categories WHERE id=$1 FOR SHARE", *step.MediaUpload.CategoryID).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "media_category_not_found")
			return
		}
		if err != nil {
			internal(w, err)
			return
		}
	}
	state.Steps = input.Steps
	if err := saveWelcome(r.Context(), tx, &state); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, state)
}

func (a *App) transitionWelcome(w http.ResponseWriter, r *http.Request, _ Guest) {
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
	switch input.Action {
	case "start":
		if !state.Open {
			fail(w, 409, "invalid_welcome_transition")
			return
		}
		state.Open, state.CurrentStep = false, 0
	case "next":
		if state.Open || state.CurrentStep >= len(state.Steps) {
			fail(w, 409, "invalid_welcome_transition")
			return
		}
		state.CurrentStep++
	case "open":
		if state.Open {
			fail(w, 409, "invalid_welcome_transition")
			return
		}
		state.Open, state.CurrentStep = true, 0
	default:
		fail(w, 409, "invalid_welcome_transition")
		return
	}
	if err := saveWelcome(r.Context(), tx, &state); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, state)
}

func saveWelcome(ctx context.Context, tx *sql.Tx, state *welcomeState) error {
	steps, err := json.Marshal(state.Steps)
	if err != nil {
		return err
	}
	state.Revision++
	if _, err = tx.ExecContext(ctx, "UPDATE welcome SET is_open=$1,revision=$2,current_step=$3,steps=$4 WHERE id=1", state.Open, state.Revision, state.CurrentStep, steps); err != nil {
		return err
	}
	return tx.Commit()
}
