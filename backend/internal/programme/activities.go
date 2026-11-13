package programme

import (
	"context"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	// OptionLimit bounds the options of one vote, write-ins included.
	OptionLimit = 200
	// minimumOptions is the fewest options a vote needs to offer a choice.
	minimumOptions = 2
	questionLength = 240
	labelLength    = 80
)

type ActivityError string

func (e ActivityError) Error() string { return string(e) }

const (
	ErrInvalidActivity  ActivityError = "invalid_activity"
	ErrActivityConflict ActivityError = "activity_conflict"
	ErrVoteClosed       ActivityError = "vote_closed"
	ErrInvalidOption    ActivityError = "invalid_vote_option"
	ErrSelfVote         ActivityError = "self_vote_forbidden"
	ErrWriteInsDisabled ActivityError = "write_ins_disabled"
	ErrOptionLimit      ActivityError = "vote_option_limit"
	ErrInvalidLabel     ActivityError = "invalid_vote_label"
)

// VoteStatus is the host-controlled phase of a vote; it only moves forward.
type VoteStatus string

const (
	VoteDraft  VoteStatus = "draft"
	VoteOpen   VoteStatus = "open"
	VoteClosed VoteStatus = "closed"
)

// next returns the only phase a vote may move to, if any.
func (s VoteStatus) next() (VoteStatus, bool) {
	switch s {
	case VoteDraft:
		return VoteOpen, true
	case VoteOpen:
		return VoteClosed, true
	}
	return "", false
}

// VoteChoices is where the options of a vote come from. It is chosen with the
// vote and frozen once voting starts.
type VoteChoices string

const (
	// ChoicesGuests offers guests picked by the host.
	ChoicesGuests VoteChoices = "guests"
	// ChoicesCustom offers labels written by the host and, when the vote
	// allows write-ins, by guests.
	ChoicesCustom VoteChoices = "custom"
)

// VoteOption is one choice with its live count. It never says who chose it.
type VoteOption struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
	// GuestID and AvatarURL are set for the options of a guests vote.
	GuestID   *int64  `json:"guestId"`
	AvatarURL *string `json:"avatarUrl"`
	// Active is false for a revoked guest, who can no longer receive votes.
	Active bool `json:"active"`
	// WriteIn marks an option added by a guest rather than by the host.
	WriteIn bool `json:"writeIn"`
	Votes   int  `json:"votes"`
}

// Vote is the same for every viewer who can see it, except for the viewer's
// own choice and whether they can vote. Options are ordered by descending
// votes, then label and ID.
type Vote struct {
	Question      string       `json:"question"`
	Status        VoteStatus   `json:"status"`
	Choices       VoteChoices  `json:"choices"`
	AllowSelfVote bool         `json:"allowSelfVote"`
	AllowWriteIns bool         `json:"allowWriteIns"`
	Options       []VoteOption `json:"options"`
	MyOptionID    *int64       `json:"myOptionId"`
	CanVote       bool         `json:"canVote"`
}

// VoteInput is the host-authored vote configuration. CandidateIDs belongs to
// a guests vote and Labels to a custom one. After normalization the question
// and labels are trimmed and the options are distinct.
type VoteInput struct {
	Question      string      `json:"question"`
	Choices       VoteChoices `json:"choices"`
	CandidateIDs  []int64     `json:"candidateIds"`
	Labels        []string    `json:"labels"`
	AllowSelfVote bool        `json:"allowSelfVote"`
	AllowWriteIns bool        `json:"allowWriteIns"`
}

func (vote VoteInput) normalize() (VoteInput, error) {
	vote.Question = strings.TrimSpace(vote.Question)
	if vote.Question == "" || utf8.RuneCountInString(vote.Question) > questionLength {
		return vote, ErrInvalidActivity
	}
	switch vote.Choices {
	case ChoicesGuests:
		if vote.AllowWriteIns || len(vote.Labels) != 0 || !validCandidates(vote.CandidateIDs) {
			return vote, ErrInvalidActivity
		}
		vote.CandidateIDs = slices.Clone(vote.CandidateIDs)
		vote.Labels = nil
	case ChoicesCustom:
		if vote.AllowSelfVote || len(vote.CandidateIDs) != 0 {
			return vote, ErrInvalidActivity
		}
		labels, err := normalizeLabels(vote.Labels, vote.AllowWriteIns)
		if err != nil {
			return vote, err
		}
		vote.Labels = labels
		vote.CandidateIDs = nil
	default:
		return vote, ErrInvalidActivity
	}
	return vote, nil
}

func validCandidates(ids []int64) bool {
	if len(ids) < minimumOptions || len(ids) > OptionLimit {
		return false
	}
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

// normalizeLabels trims the host's labels and rejects duplicates. A vote that
// accepts write-ins may start with fewer than two labels, or none.
func normalizeLabels(labels []string, allowWriteIns bool) ([]string, error) {
	if len(labels) > OptionLimit || len(labels) < minimumOptions && !allowWriteIns {
		return nil, ErrInvalidActivity
	}
	normalized := make([]string, 0, len(labels))
	seen := make(map[string]bool, len(labels))
	for _, label := range labels {
		label, err := normalizeLabel(label)
		if err != nil {
			return nil, err
		}
		key := labelKey(label)
		if seen[key] {
			return nil, ErrInvalidActivity
		}
		seen[key] = true
		normalized = append(normalized, label)
	}
	return normalized, nil
}

// normalizeLabel returns the label as it is stored: trimmed, spelling kept.
func normalizeLabel(label string) (string, error) {
	label = strings.TrimSpace(label)
	if label == "" || utf8.RuneCountInString(label) > labelLength {
		return "", ErrInvalidLabel
	}
	return label, nil
}

// labelKey identifies a trimmed label regardless of case: two labels with the
// same key are the same option.
func labelKey(label string) string { return strings.ToLower(label) }

// CheckEdit keeps the options and voting rules frozen once voting starts, so
// recorded ballots keep their meaning. The question stays editable.
func (event Event) CheckEdit(input Input) error {
	if input.Type != "" && event.Type != input.Type {
		return ErrActivityConflict
	}
	if (event.Vote != nil || event.Questions != nil) && event.Revision != input.Revision {
		return ErrActivityConflict
	}
	if input.Vote == nil {
		return nil
	}
	if event.Vote == nil {
		return ErrActivityConflict
	}
	if event.Vote.Status != VoteDraft && !event.Vote.keptBy(*input.Vote) {
		return ErrActivityConflict
	}
	return nil
}

// keptBy reports whether the input leaves the frozen settings unchanged. The
// order of the options carries no meaning. A custom vote must list every label
// of the host; it may also list current write-ins, which the host does not own
// and an edit never changes.
func (vote Vote) keptBy(input VoteInput) bool {
	if vote.Choices != input.Choices || vote.AllowSelfVote != input.AllowSelfVote || vote.AllowWriteIns != input.AllowWriteIns {
		return false
	}
	if vote.Choices == ChoicesGuests {
		if len(vote.Options) != len(input.CandidateIDs) {
			return false
		}
		for _, option := range vote.Options {
			if option.GuestID == nil || !slices.Contains(input.CandidateIDs, *option.GuestID) {
				return false
			}
		}
		return true
	}
	unknown := make(map[string]bool, len(input.Labels))
	for _, label := range input.Labels {
		unknown[labelKey(label)] = true
	}
	for _, option := range vote.Options {
		key := labelKey(option.Label)
		if !option.WriteIn && !unknown[key] {
			return false
		}
		delete(unknown, key)
	}
	return len(unknown) == 0
}

func (event Event) CheckTransition(status VoteStatus, revision int64) error {
	if event.Vote == nil {
		return ErrNotFound
	}
	if revision != event.Revision {
		return ErrActivityConflict
	}
	if expected, ok := event.Vote.Status.next(); !ok || expected != status {
		return ErrActivityConflict
	}
	if status == VoteOpen && event.Vote.Choices == ChoicesGuests {
		active := 0
		for _, option := range event.Vote.Options {
			if option.Active {
				active++
			}
		}
		if active < minimumOptions {
			return ErrInvalidOption
		}
	}
	return nil
}

// CheckBallot decides whether the guest may vote for an existing option.
func (event Event) CheckBallot(guestID, optionID int64) error {
	if event.Vote == nil {
		return ErrNotFound
	}
	if event.Vote.Status != VoteOpen {
		return ErrVoteClosed
	}
	for _, option := range event.Vote.Options {
		if option.ID == optionID {
			return event.Vote.checkOption(option, guestID)
		}
	}
	return ErrInvalidOption
}

// checkOption applies the eligibility rules of one option to a voter.
func (vote Vote) checkOption(option VoteOption, guestID int64) error {
	if !option.Active {
		return ErrInvalidOption
	}
	if !vote.AllowSelfVote && option.GuestID != nil && *option.GuestID == guestID {
		return ErrSelfVote
	}
	return nil
}

// CheckWriteIn decides whether a guest may vote for a label they typed.
// exists reports whether an option already carries that label; otherwise the
// label becomes a new option, within the vote's limit.
func (event Event) CheckWriteIn(exists bool) error {
	if event.Vote == nil {
		return ErrNotFound
	}
	if event.Vote.Choices != ChoicesCustom || !event.Vote.AllowWriteIns {
		return ErrWriteInsDisabled
	}
	if event.Vote.Status != VoteOpen {
		return ErrVoteClosed
	}
	if !exists && len(event.Vote.Options) >= OptionLimit {
		return ErrOptionLimit
	}
	return nil
}

// CheckRemoval lets the host moderate write-ins in any phase. The host's own
// options are part of the frozen settings and stay.
func (event Event) CheckRemoval(optionID int64) error {
	if event.Vote == nil {
		return ErrNotFound
	}
	for _, option := range event.Vote.Options {
		if option.ID != optionID {
			continue
		}
		if !option.WriteIn {
			return ErrActivityConflict
		}
		return nil
	}
	return ErrInvalidOption
}

// VoteView sets whether the viewer can vote now: the vote is open and offers
// them at least one eligible option or accepts write-ins.
func (event Event) VoteView(guestID int64) Event {
	if event.Vote == nil {
		return event
	}
	vote := *event.Vote
	event.Vote = &vote
	vote.CanVote = vote.Status == VoteOpen && (vote.AllowWriteIns || slices.ContainsFunc(vote.Options, func(option VoteOption) bool {
		return vote.checkOption(option, guestID) == nil
	}))
	return event
}

type Actor struct {
	GuestID     int64
	SessionHash string
}

func (s *Service) Transition(ctx context.Context, actor Actor, eventID int64, status VoteStatus, revision int64) (Event, error) {
	return s.repository.TransitionVote(ctx, actor, eventID, status, revision)
}

// Vote records the actor's choice of an existing option, replacing any earlier one.
func (s *Service) Vote(ctx context.Context, actor Actor, eventID, optionID int64) (Event, error) {
	if optionID <= 0 {
		return Event{}, ErrInvalidOption
	}
	return s.repository.CastVote(ctx, actor, eventID, optionID)
}

// WriteIn records the actor's vote for a label they typed. The label joins
// the option that already carries it, whatever its case, or becomes a new one.
func (s *Service) WriteIn(ctx context.Context, actor Actor, eventID int64, label string) (Event, error) {
	label, err := normalizeLabel(label)
	if err != nil {
		return Event{}, err
	}
	return s.repository.CastWriteIn(ctx, actor, eventID, label)
}

// RemoveOption deletes a write-in option together with its votes.
func (s *Service) RemoveOption(ctx context.Context, actor Actor, eventID, optionID int64) (Event, error) {
	if optionID <= 0 {
		return Event{}, ErrInvalidOption
	}
	return s.repository.RemoveVoteOption(ctx, actor, eventID, optionID)
}
