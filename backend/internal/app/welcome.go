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
	Widgets []welcomeWidget `json:"widgets"`
}

type welcomeWidget struct {
	Type        string              `json:"type"`
	Text        string              `json:"text,omitempty"`
	MediaUpload *welcomeMediaUpload `json:"mediaUpload,omitempty"`
}

func (w *welcomeWidget) UnmarshalJSON(data []byte) error {
	type widget welcomeWidget
	var input widget
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for name := range fields {
		if name != "type" && name != "text" && name != "mediaUpload" {
			return errors.New("unsupported welcome widget field")
		}
	}
	if _, exists := fields["text"]; exists && input.Type != "title" && input.Type != "text" {
		return errors.New("text is only supported on title and text widgets")
	}
	if _, exists := fields["mediaUpload"]; exists && input.Type != "media_upload" {
		return errors.New("mediaUpload is only supported on media upload widgets")
	}
	*w = welcomeWidget(input)
	return nil
}

type welcomeMediaUpload struct {
	CategoryID *int64 `json:"categoryId"`
}

func (m *welcomeMediaUpload) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for name := range fields {
		if name != "categoryId" {
			return errors.New("unsupported media upload setting")
		}
	}
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
	Required    bool          `json:"required"`
	Generation  int64         `json:"-"`
	Steps       []welcomeStep `json:"steps"`
}

type welcomeView struct {
	Open             bool                `json:"open"`
	Revision         int64               `json:"revision"`
	ProgressRevision int64               `json:"progressRevision"`
	Step             *visibleWelcomeStep `json:"step"`
	CanPrevious      bool                `json:"canPrevious"`
	CanNext          bool                `json:"canNext"`
	CanFinish        bool                `json:"canFinish"`
}

type visibleWelcomeStep struct {
	Position int             `json:"position"`
	Widgets  []welcomeWidget `json:"widgets"`
}

func (a *App) getAdminWelcome(w http.ResponseWriter, r *http.Request, _ Guest) {
	state, err := scanWelcome(a.db.QueryRowContext(r.Context(), welcomeSelect))
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, state)
}

func scanWelcome(row *sql.Row) (welcomeState, error) {
	var state welcomeState
	var steps []byte
	if err := row.Scan(&state.Open, &state.Revision, &state.CurrentStep, &state.Required, &state.Generation, &steps); err != nil {
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
	state, err := scanWelcome(tx.QueryRowContext(ctx, welcomeSelect+" FOR UPDATE"))
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
	// The bounded widget collection can exceed the usual 64 KiB JSON limit.
	if !decodeLimit(w, r, &input, 1<<20) {
		return
	}
	if input.Revision == nil || *input.Revision < 0 || input.Steps == nil || len(input.Steps) > 12 {
		fail(w, 400, "invalid_welcome_steps")
		return
	}
	for i := range input.Steps {
		step := &input.Steps[i]
		if len(step.Widgets) < 1 || len(step.Widgets) > 12 {
			fail(w, 400, "invalid_welcome_steps")
			return
		}
		profile, notifications := false, false
		for j := range step.Widgets {
			widget := &step.Widgets[j]
			switch widget.Type {
			case "title", "text":
				widget.Text = strings.TrimSpace(widget.Text)
				limit := 1000
				if widget.Type == "title" {
					limit = 120
				}
				if widget.Text == "" || utf8.RuneCountInString(widget.Text) > limit {
					fail(w, 400, "invalid_welcome_steps")
					return
				}
			case "profile_photo":
				if profile {
					fail(w, 400, "invalid_welcome_action")
					return
				}
				profile = true
			case "enable_notifications":
				if notifications {
					fail(w, 400, "invalid_welcome_action")
					return
				}
				notifications = true
			case "media_upload":
				if widget.MediaUpload == nil || widget.MediaUpload.CategoryID != nil && *widget.MediaUpload.CategoryID < 1 {
					fail(w, 400, "invalid_welcome_action")
					return
				}
			default:
				fail(w, 400, "invalid_welcome_action")
				return
			}
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
	if state.CurrentStep > 0 {
		fail(w, 409, "welcome_steps_locked")
		return
	}
	for _, step := range input.Steps {
		for _, widget := range step.Widgets {
			if widget.MediaUpload == nil || widget.MediaUpload.CategoryID == nil {
				continue
			}
			var id int64
			err := tx.QueryRowContext(r.Context(), "SELECT id FROM media_categories WHERE id=$1 FOR SHARE", *widget.MediaUpload.CategoryID).Scan(&id)
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 404, "media_category_not_found")
				return
			}
			if err != nil {
				internal(w, err)
				return
			}
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
		state.Generation++
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
		state.Open, state.CurrentStep = true, len(state.Steps)
	default:
		fail(w, 409, "invalid_welcome_transition")
		return
	}
	if err := a.queueWelcomeNotifications(r.Context(), tx, state, input.Action); err != nil {
		internal(w, err)
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
	if _, err = tx.ExecContext(ctx, "UPDATE welcome SET is_open=$1,revision=$2,current_step=$3,steps=$4,required=$5,generation=$6 WHERE id=1", state.Open, state.Revision, state.CurrentStep, steps, state.Required, state.Generation); err != nil {
		return err
	}
	return tx.Commit()
}
