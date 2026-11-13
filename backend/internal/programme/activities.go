package programme

import (
	"context"
	"slices"
	"strings"
	"unicode/utf8"
)

const CandidateLimit = 200

type ActivityError string

func (e ActivityError) Error() string { return string(e) }

const (
	ErrInvalidActivity  ActivityError = "invalid_activity"
	ErrActivityConflict ActivityError = "activity_conflict"
	ErrVoteClosed       ActivityError = "vote_closed"
	ErrInvalidCandidate ActivityError = "invalid_vote_candidate"
	ErrSelfVote         ActivityError = "self_vote_forbidden"
)

type Candidate struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
	Active    bool    `json:"active"`
}

type VoteResult struct {
	CandidateID int64 `json:"candidateId"`
	Votes       int   `json:"votes"`
}

// VoteStatus is the host-controlled phase of a vote; it only moves forward.
type VoteStatus string

const (
	VoteDraft    VoteStatus = "draft"
	VoteOpen     VoteStatus = "open"
	VoteClosed   VoteStatus = "closed"
	VoteRevealed VoteStatus = "revealed"
)

// next returns the only phase a vote may move to, if any.
func (s VoteStatus) next() (VoteStatus, bool) {
	switch s {
	case VoteDraft:
		return VoteOpen, true
	case VoteOpen:
		return VoteClosed, true
	case VoteClosed:
		return VoteRevealed, true
	}
	return "", false
}

type Vote struct {
	Question           string       `json:"question"`
	Status             VoteStatus   `json:"status"`
	AllowSelfVote      bool         `json:"allowSelfVote"`
	Candidates         []Candidate  `json:"candidates"`
	MyCandidateID      *int64       `json:"myCandidateId"`
	CanVote            bool         `json:"canVote"`
	ParticipationCount *int         `json:"participationCount"`
	Results            []VoteResult `json:"results"`
}

type VoteInput struct {
	Question      string  `json:"question"`
	CandidateIDs  []int64 `json:"candidateIds"`
	AllowSelfVote bool    `json:"allowSelfVote"`
}

func (vote VoteInput) normalize() (VoteInput, error) {
	vote.Question = strings.TrimSpace(vote.Question)
	if vote.Question == "" || utf8.RuneCountInString(vote.Question) > 240 || len(vote.CandidateIDs) < 2 || len(vote.CandidateIDs) > CandidateLimit {
		return vote, ErrInvalidActivity
	}
	seen := make(map[int64]bool, len(vote.CandidateIDs))
	for _, id := range vote.CandidateIDs {
		if id <= 0 || seen[id] {
			return vote, ErrInvalidActivity
		}
		seen[id] = true
	}
	vote.CandidateIDs = slices.Clone(vote.CandidateIDs)
	return vote, nil
}

// CheckEdit preserves the electorate and existing ballots once voting starts.
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
	if event.Vote.Status == VoteDraft {
		return nil
	}
	ids := make([]int64, 0, len(event.Vote.Candidates))
	for _, candidate := range event.Vote.Candidates {
		ids = append(ids, candidate.ID)
	}
	if event.Vote.AllowSelfVote != input.Vote.AllowSelfVote || !slices.Equal(ids, input.Vote.CandidateIDs) {
		return ErrActivityConflict
	}
	return nil
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
	if status == VoteOpen {
		active := 0
		for _, candidate := range event.Vote.Candidates {
			if candidate.Active {
				active++
			}
		}
		if active < 2 {
			return ErrInvalidCandidate
		}
	}
	return nil
}

func (event Event) CheckBallot(guestID, candidateID int64) error {
	if event.Vote == nil {
		return ErrNotFound
	}
	if event.Vote.Status != VoteOpen {
		return ErrVoteClosed
	}
	if !event.Vote.AllowSelfVote && guestID == candidateID {
		return ErrSelfVote
	}
	for _, candidate := range event.Vote.Candidates {
		if candidate.ID == candidateID && candidate.Active {
			return nil
		}
	}
	return ErrInvalidCandidate
}

// VoteView strips unrevealed totals even for administrators using the guest endpoint.
func (event Event) VoteView(guestID int64, adminView bool) Event {
	if event.Vote == nil {
		return event
	}
	vote := *event.Vote
	event.Vote = &vote
	vote.CanVote = false
	if vote.Status == VoteOpen && !adminView {
		for _, candidate := range vote.Candidates {
			if candidate.Active && (vote.AllowSelfVote || candidate.ID != guestID) {
				vote.CanVote = true
			}
		}
	}
	if vote.Status != VoteRevealed {
		vote.Results = nil
		if !adminView {
			vote.ParticipationCount = nil
		}
	}
	return event
}

type Actor struct {
	GuestID     int64
	SessionHash string
}

func (s *Service) Transition(ctx context.Context, actor Actor, eventID int64, status VoteStatus, revision int64) (Event, error) {
	return s.repository.TransitionVote(ctx, actor, eventID, status, revision)
}

func (s *Service) Vote(ctx context.Context, actor Actor, eventID, candidateID int64) (Event, error) {
	if candidateID <= 0 {
		return Event{}, ErrInvalidCandidate
	}
	return s.repository.CastVote(ctx, actor, eventID, candidateID)
}
