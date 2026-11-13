package welcome

import (
	"context"
	"strings"
	"unicode/utf8"
)

// Error identifies a rejected welcome command without transport details.
type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrInvalidSteps     Error = "invalid_welcome_steps"
	ErrInvalidAction    Error = "invalid_welcome_action"
	ErrConflict         Error = "welcome_conflict"
	ErrTransition       Error = "invalid_welcome_transition"
	ErrCategoryNotFound Error = "media_category_not_found"
)

// Action is a host transition or a guest navigation command.
type Action string

const (
	// Host transitions.
	ActionStart Action = "start"
	ActionOpen  Action = "open"
	// ActionNext unlocks one more step for the host and advances a guest.
	ActionNext Action = "next"
	// Guest navigation.
	ActionPrevious Action = "previous"
	ActionFinish   Action = "finish"
)

// Repository executes each change atomically, checking revisions under a lock.
// Host transitions also enqueue notifications in the same commit.
type Repository interface {
	State(context.Context) (State, error)
	Edit(context.Context, int64, []Step) (State, error)
	Transition(context.Context, int64, Action) (State, error)
	SetRequired(context.Context, int64, bool) (State, error)
	Enroll(context.Context, int64) (State, Progress, error)
	Navigate(context.Context, int64, int64, Action) (State, Progress, error)
}

type Service struct{ repository Repository }

func New(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) State(ctx context.Context) (State, error) { return s.repository.State(ctx) }
func (s *Service) Edit(ctx context.Context, revision int64, steps []Step) (State, error) {
	normalized, err := NormalizeSteps(steps)
	if err != nil {
		return State{}, err
	}
	return s.repository.Edit(ctx, revision, normalized)
}

func (s *Service) Transition(ctx context.Context, revision int64, action Action) (State, error) {
	return s.repository.Transition(ctx, revision, action)
}

func (s *Service) SetRequired(ctx context.Context, revision int64, required bool) (State, error) {
	return s.repository.SetRequired(ctx, revision, required)
}

func (s *Service) View(ctx context.Context, guestID int64) (View, error) {
	state, progress, err := s.repository.Enroll(ctx, guestID)
	if err != nil {
		return View{}, err
	}
	return GuestView(state, progress), nil
}

func (s *Service) Navigate(ctx context.Context, guestID, revision int64, action Action) (View, error) {
	state, progress, err := s.repository.Navigate(ctx, guestID, revision, action)
	if err != nil {
		return View{}, err
	}
	return GuestView(state, progress), nil
}

// NormalizeSteps validates authored widgets and returns an independent copy.
func NormalizeSteps(steps []Step) ([]Step, error) {
	if steps == nil || len(steps) > 12 {
		return nil, ErrInvalidSteps
	}
	result := make([]Step, len(steps))
	for i, step := range steps {
		if len(step.Widgets) < 1 || len(step.Widgets) > 12 {
			return nil, ErrInvalidSteps
		}
		result[i].Widgets = append([]Widget(nil), step.Widgets...)
		profile, notifications := false, false
		for j := range result[i].Widgets {
			widget := &result[i].Widgets[j]
			if !widget.Type.authored() && widget.Text != "" {
				return nil, ErrInvalidAction
			}
			if widget.Type != WidgetMediaUpload && widget.MediaUpload != nil {
				return nil, ErrInvalidAction
			}
			switch widget.Type {
			case WidgetTitle, WidgetText:
				widget.Text = strings.TrimSpace(widget.Text)
				limit := 1000
				if widget.Type == WidgetTitle {
					limit = 120
				}
				if widget.Text == "" || utf8.RuneCountInString(widget.Text) > limit {
					return nil, ErrInvalidSteps
				}
			case WidgetProfilePhoto:
				if profile {
					return nil, ErrInvalidAction
				}
				profile = true
			case WidgetEnableNotifications:
				if notifications {
					return nil, ErrInvalidAction
				}
				notifications = true
			case WidgetMediaUpload:
				if widget.MediaUpload == nil || widget.MediaUpload.CategoryID != nil && *widget.MediaUpload.CategoryID < 1 {
					return nil, ErrInvalidAction
				}
				destination := *widget.MediaUpload
				if destination.CategoryID != nil {
					id := *destination.CategoryID
					destination.CategoryID = &id
				}
				widget.MediaUpload = &destination
			default:
				return nil, ErrInvalidAction
			}
		}
	}
	return result, nil
}

func CheckRevision(state State, revision int64) error {
	if revision < 0 || state.Revision != revision {
		return ErrConflict
	}
	return nil
}

func Edit(state State, revision int64, steps []Step) (State, error) {
	if err := CheckRevision(state, revision); err != nil {
		return state, err
	}
	state.Steps = steps
	if state.Open && state.Generation > 0 {
		state.CurrentStep = len(steps)
	} else {
		state.CurrentStep = min(state.CurrentStep, len(steps))
	}
	return state, nil
}

func Transition(state State, revision int64, action Action) (State, error) {
	if err := CheckRevision(state, revision); err != nil {
		return state, err
	}
	switch action {
	case ActionStart:
		if !state.Open {
			return state, ErrTransition
		}
		state.Open, state.CurrentStep = false, 0
		state.Generation++
	case ActionNext:
		if state.Open || state.CurrentStep >= len(state.Steps) {
			return state, ErrTransition
		}
		state.CurrentStep++
	case ActionOpen:
		if state.Open {
			return state, ErrTransition
		}
		state.Open, state.CurrentStep = true, len(state.Steps)
	default:
		return state, ErrTransition
	}
	return state, nil
}

// InitialProgress enrolls late arrivals without advancing existing participants.
func InitialProgress(state State) Progress {
	position := state.CurrentStep
	if state.Required && position > 0 {
		position = 1
	}
	return Progress{Generation: state.Generation, Position: position, Completed: state.Open && !state.Required}
}

// EnterFirstStep starts waiting participants once a step is available. Later
// steps remain guest-controlled. The caller assigns a new revision on entry.
func EnterFirstStep(state State, progress Progress) (Progress, bool) {
	if state.Generation == 0 || progress.Generation != state.Generation || progress.Completed || progress.Position != 0 || state.CurrentStep == 0 {
		return progress, false
	}
	progress.Position = 1
	return progress, true
}

func Navigate(state State, progress Progress, revision int64, action Action) (Progress, error) {
	if revision < 0 || progress.Generation != state.Generation || progress.Revision != revision {
		return progress, ErrConflict
	}
	view := GuestView(state, progress)
	switch {
	case action == ActionPrevious && view.CanPrevious:
		progress.Position--
	case action == ActionNext && view.CanNext:
		progress.Position++
	case action == ActionFinish && view.CanFinish:
		progress.Completed = true
	default:
		return progress, ErrTransition
	}
	return progress, nil
}
