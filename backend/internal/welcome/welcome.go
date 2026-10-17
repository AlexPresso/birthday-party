// Package welcome owns welcome sequence rules and guest navigation.
package welcome

import (
	"bytes"
	"encoding/json"
	"errors"
)

type Step struct {
	Widgets []Widget `json:"widgets"`
}

type Widget struct {
	Type        string       `json:"type"`
	Text        string       `json:"text,omitempty"`
	MediaUpload *MediaUpload `json:"mediaUpload,omitempty"`
}

func (w *Widget) UnmarshalJSON(data []byte) error {
	type widget Widget
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
	*w = Widget(input)
	return nil
}

type MediaUpload struct {
	CategoryID *int64 `json:"categoryId"`
}

func (m *MediaUpload) UnmarshalJSON(data []byte) error {
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

type State struct {
	Open        bool   `json:"open"`
	Revision    int64  `json:"revision"`
	CurrentStep int    `json:"currentStep"`
	Required    bool   `json:"required"`
	Generation  int64  `json:"-"`
	Steps       []Step `json:"steps"`
}

type View struct {
	Open             bool         `json:"open"`
	Revision         int64        `json:"revision"`
	ProgressRevision int64        `json:"progressRevision"`
	Step             *VisibleStep `json:"step"`
	CanPrevious      bool         `json:"canPrevious"`
	CanNext          bool         `json:"canNext"`
	CanFinish        bool         `json:"canFinish"`
}

type VisibleStep struct {
	Position int      `json:"position"`
	Widgets  []Widget `json:"widgets"`
}

type Progress struct {
	Generation int64
	Position   int
	Revision   int64
	Completed  bool
}

func HasAccess(state State, progress Progress) bool {
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

func GuestView(state State, progress Progress) View {
	view := View{Open: HasAccess(state, progress), Revision: state.Revision, ProgressRevision: progress.Revision}
	if view.Open || progress.Generation != state.Generation {
		return view
	}
	if progress.Position > 0 && progress.Position <= state.CurrentStep {
		view.Step = &VisibleStep{Position: progress.Position, Widgets: state.Steps[progress.Position-1].Widgets}
	}
	view.CanPrevious = progress.Position > 1
	view.CanNext = progress.Position < state.CurrentStep
	view.CanFinish = state.Open && (!state.Required || progress.Position == len(state.Steps))
	return view
}
