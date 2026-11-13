// Package welcome owns welcome sequence rules and guest navigation.
package welcome

import (
	"bytes"
	"encoding/json"
	"errors"
	"slices"
)

type Step struct {
	Widgets []Widget `json:"widgets"`
}

// WidgetType names what a welcome widget shows or lets the guest do.
type WidgetType string

const (
	WidgetTitle               WidgetType = "title"
	WidgetText                WidgetType = "text"
	WidgetProfilePhoto        WidgetType = "profile_photo"
	WidgetMediaUpload         WidgetType = "media_upload"
	WidgetEnableNotifications WidgetType = "enable_notifications"
	// WidgetRules lists rules the guest ticks before leaving the step.
	WidgetRules WidgetType = "rules"
)

// authored reports whether the widget carries host-written text.
func (t WidgetType) authored() bool { return t == WidgetTitle || t == WidgetText }

type Widget struct {
	Type        WidgetType   `json:"type"`
	Text        string       `json:"text,omitempty"`
	MediaUpload *MediaUpload `json:"mediaUpload,omitempty"`
	Rules       []string     `json:"rules,omitempty"`
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
		if name != "type" && name != "text" && name != "mediaUpload" && name != "rules" {
			return errors.New("unsupported welcome widget field")
		}
	}
	if _, exists := fields["text"]; exists && !input.Type.authored() {
		return errors.New("text is only supported on title and text widgets")
	}
	if _, exists := fields["mediaUpload"]; exists && input.Type != WidgetMediaUpload {
		return errors.New("mediaUpload is only supported on media upload widgets")
	}
	if _, exists := fields["rules"]; exists && input.Type != WidgetRules {
		return errors.New("rules are only supported on rules widgets")
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
	// RulesAccepted reports that the step has rules and this guest ticked them.
	RulesAccepted bool `json:"rulesAccepted"`
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
	// RulesAccepted reports that the guest ticked the rules at Position.
	RulesAccepted bool
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

func hasRules(widgets []Widget) bool {
	return slices.ContainsFunc(widgets, func(widget Widget) bool { return widget.Type == WidgetRules })
}

func GuestView(state State, progress Progress) View {
	view := View{Open: HasAccess(state, progress), Revision: state.Revision, ProgressRevision: progress.Revision}
	if view.Open || progress.Generation != state.Generation {
		return view
	}
	if progress.Position > 0 && progress.Position <= state.CurrentStep {
		view.Step = &VisibleStep{Position: progress.Position, Widgets: state.Steps[progress.Position-1].Widgets}
	}
	// Rules hold the guest on their step until every one of them is ticked.
	pending := false
	if view.Step != nil && hasRules(view.Step.Widgets) {
		view.RulesAccepted = progress.RulesAccepted
		pending = !progress.RulesAccepted
	}
	view.CanPrevious = progress.Position > 1
	view.CanNext = !pending && progress.Position < state.CurrentStep
	view.CanFinish = !pending && state.Open && (!state.Required || progress.Position == len(state.Steps))
	return view
}
