package programme

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func guestOption(id, guestID int64, active bool) VoteOption {
	return VoteOption{ID: id, GuestID: &guestID, Active: active}
}

func labelOption(id int64, label string, writeIn bool) VoteOption {
	return VoteOption{ID: id, Label: label, Active: true, WriteIn: writeIn}
}

func numberedLabels(count int) []string {
	labels := make([]string, count)
	for i := range labels {
		labels[i] = fmt.Sprintf("Choice %d", i)
	}
	return labels
}

func TestVoteSettingsValidation(t *testing.T) {
	valid := Input{Title: "Vote", Type: TypeVote, Vote: &VoteInput{Question: "  Best costume?  ", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}}}
	input, err := valid.normalize()
	if err != nil || input.Vote.Question != "Best costume?" || valid.Vote.Question != "  Best costume?  " {
		t.Fatalf("normalization=%+v error=%v", input, err)
	}
	custom, err := (VoteInput{Question: "Dessert?", Choices: ChoicesCustom, Labels: []string{"  Tarte tatin ", "Mousse"}}).normalize()
	if err != nil || custom.Labels[0] != "Tarte tatin" || custom.Labels[1] != "Mousse" {
		t.Fatalf("labels=%q error=%v", custom.Labels, err)
	}
	for _, test := range []struct {
		name  string
		input VoteInput
		want  error
	}{
		{"guests", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}, AllowSelfVote: true}, nil},
		{"labels", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A", "B"}}, nil},
		{"write-ins may start empty", VoteInput{Question: "Q", Choices: ChoicesCustom, AllowWriteIns: true}, nil},
		{"write-ins with one label", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A"}, AllowWriteIns: true}, nil},
		{"longest label", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{strings.Repeat("é", 80), "B"}}, nil},
		{"most labels", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: numberedLabels(OptionLimit)}, nil},
		{"empty question", VoteInput{Question: " ", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}}, ErrInvalidActivity},
		{"long question", VoteInput{Question: strings.Repeat("x", 241), Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}}, ErrInvalidActivity},
		{"missing source", VoteInput{Question: "Q", CandidateIDs: []int64{1, 2}}, ErrInvalidActivity},
		{"unknown source", VoteInput{Question: "Q", Choices: "ranked", CandidateIDs: []int64{1, 2}}, ErrInvalidActivity},
		{"one candidate", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{1}}, ErrInvalidActivity},
		{"repeated candidate", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{1, 1}}, ErrInvalidActivity},
		{"invalid candidate", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{0, 2}}, ErrInvalidActivity},
		{"guests with labels", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}, Labels: []string{"A"}}, ErrInvalidActivity},
		{"guests with write-ins", VoteInput{Question: "Q", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}, AllowWriteIns: true}, ErrInvalidActivity},
		{"labels with candidates", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A", "B"}, CandidateIDs: []int64{1}}, ErrInvalidActivity},
		{"labels with self-vote", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A", "B"}, AllowSelfVote: true}, ErrInvalidActivity},
		{"one label without write-ins", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A"}}, ErrInvalidActivity},
		{"no label without write-ins", VoteInput{Question: "Q", Choices: ChoicesCustom}, ErrInvalidActivity},
		{"labels differing by case and spaces", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"Tarte", "  tARTE "}}, ErrInvalidActivity},
		{"too many labels", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: numberedLabels(OptionLimit + 1)}, ErrInvalidActivity},
		{"blank label", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A", "  "}}, ErrInvalidLabel},
		{"long label", VoteInput{Question: "Q", Choices: ChoicesCustom, Labels: []string{"A", strings.Repeat("é", 81)}}, ErrInvalidLabel},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := test.input.normalize(); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestOpenedVoteFreezesItsSettings(t *testing.T) {
	guests := Event{Type: TypeVote, Revision: 3, Vote: &Vote{Status: VoteOpen, Choices: ChoicesGuests, Options: []VoteOption{guestOption(10, 1, true), guestOption(11, 2, true)}}}
	labels := Event{Type: TypeVote, Revision: 3, Vote: &Vote{Status: VoteClosed, Choices: ChoicesCustom, AllowWriteIns: true, Options: []VoteOption{
		labelOption(20, "Tarte", false), labelOption(21, "Mousse", false), labelOption(22, "Sorbet", true),
	}}}
	edit := func(revision int64, vote VoteInput) Input {
		return Input{Type: TypeVote, Revision: revision, Vote: &vote}
	}
	for _, test := range []struct {
		name  string
		event Event
		input Input
		want  error
	}{
		{"corrected question", guests, edit(3, VoteInput{Question: "Corrected", Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}}), nil},
		{"candidates in another order", guests, edit(3, VoteInput{Choices: ChoicesGuests, CandidateIDs: []int64{2, 1}}), nil},
		{"metadata only", guests, Input{Revision: 3}, nil},
		{"stale revision", guests, edit(2, VoteInput{Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}}), ErrActivityConflict},
		{"changed type", guests, Input{Type: TypeEvent, Revision: 3}, ErrActivityConflict},
		{"added candidate", guests, edit(3, VoteInput{Choices: ChoicesGuests, CandidateIDs: []int64{1, 2, 3}}), ErrActivityConflict},
		{"replaced candidate", guests, edit(3, VoteInput{Choices: ChoicesGuests, CandidateIDs: []int64{1, 3}}), ErrActivityConflict},
		{"changed self-vote", guests, edit(3, VoteInput{Choices: ChoicesGuests, CandidateIDs: []int64{1, 2}, AllowSelfVote: true}), ErrActivityConflict},
		{"changed source", guests, edit(3, VoteInput{Choices: ChoicesCustom, Labels: []string{"A", "B"}}), ErrActivityConflict},
		{"host labels", labels, edit(3, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true, Labels: []string{"mousse", "TARTE"}}), nil},
		{"host labels and current write-ins", labels, edit(3, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true, Labels: []string{"Tarte", "Mousse", "Sorbet"}}), nil},
		{"removed host label", labels, edit(3, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true, Labels: []string{"Tarte", "Sorbet"}}), ErrActivityConflict},
		{"added label", labels, edit(3, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true, Labels: []string{"Tarte", "Mousse", "Flan"}}), ErrActivityConflict},
		{"changed write-ins", labels, edit(3, VoteInput{Choices: ChoicesCustom, Labels: []string{"Tarte", "Mousse"}}), ErrActivityConflict},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.event.CheckEdit(test.input); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
	draft := Event{Type: TypeVote, Revision: 3, Vote: &Vote{Status: VoteDraft, Choices: ChoicesGuests, Options: guests.Vote.Options}}
	if err := draft.CheckEdit(edit(3, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true})); err != nil {
		t.Fatalf("draft refused new settings: %v", err)
	}
	if err := (Event{Type: TypeEvent}).CheckEdit(edit(0, VoteInput{Choices: ChoicesCustom, AllowWriteIns: true})); !errors.Is(err, ErrActivityConflict) {
		t.Fatalf("ordinary event accepted vote settings: %v", err)
	}
}

func TestVoteTransitionsOnlyMoveForward(t *testing.T) {
	event := Event{Type: TypeVote, Revision: 4, Vote: &Vote{Status: VoteDraft, Choices: ChoicesGuests, Options: []VoteOption{guestOption(10, 1, true), guestOption(11, 2, true)}}}
	for _, test := range []struct {
		from, to VoteStatus
		revision int64
		want     error
	}{
		{VoteDraft, VoteOpen, 4, nil},
		{VoteDraft, VoteOpen, 3, ErrActivityConflict},
		{VoteDraft, VoteClosed, 4, ErrActivityConflict},
		{VoteOpen, VoteClosed, 4, nil},
		{VoteOpen, VoteDraft, 4, ErrActivityConflict},
		{VoteClosed, VoteOpen, 4, ErrActivityConflict},
		{VoteClosed, "revealed", 4, ErrActivityConflict},
	} {
		event.Vote.Status = test.from
		if err := event.CheckTransition(test.to, test.revision); !errors.Is(err, test.want) {
			t.Fatalf("%s -> %s at revision %d: error=%v want=%v", test.from, test.to, test.revision, err, test.want)
		}
	}
	event.Vote.Status = VoteDraft
	event.Vote.Options[1].Active = false
	if err := event.CheckTransition(VoteOpen, 4); !errors.Is(err, ErrInvalidOption) {
		t.Fatalf("opened with one active guest: %v", err)
	}
	empty := Event{Type: TypeVote, Revision: 1, Vote: &Vote{Status: VoteDraft, Choices: ChoicesCustom, AllowWriteIns: true}}
	if err := empty.CheckTransition(VoteOpen, 1); err != nil {
		t.Fatalf("write-in vote without options did not open: %v", err)
	}
	if err := (Event{Type: TypeEvent, Revision: 1}).CheckTransition(VoteOpen, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ordinary event transition: %v", err)
	}
}

func TestBallotEligibility(t *testing.T) {
	event := Event{Type: TypeVote, Vote: &Vote{Status: VoteOpen, Choices: ChoicesGuests, Options: []VoteOption{
		guestOption(10, 1, true), guestOption(11, 2, true), guestOption(12, 3, false),
	}}}
	for _, test := range []struct {
		guestID, optionID int64
		want              error
	}{{1, 11, nil}, {1, 10, ErrSelfVote}, {1, 12, ErrInvalidOption}, {1, 99, ErrInvalidOption}, {1, 2, ErrInvalidOption}} {
		if err := event.CheckBallot(test.guestID, test.optionID); !errors.Is(err, test.want) {
			t.Fatalf("guest %d option %d: error=%v want=%v", test.guestID, test.optionID, err, test.want)
		}
	}
	event.Vote.AllowSelfVote = true
	if err := event.CheckBallot(1, 10); err != nil {
		t.Fatalf("allowed self-vote refused: %v", err)
	}
	for _, status := range []VoteStatus{VoteDraft, VoteClosed} {
		event.Vote.Status = status
		if err := event.CheckBallot(1, 11); !errors.Is(err, ErrVoteClosed) {
			t.Fatalf("%s vote accepted a ballot: %v", status, err)
		}
	}
	if err := (Event{}).CheckBallot(1, 11); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ballot without vote: %v", err)
	}
}

func TestWriteInAndRemovalRules(t *testing.T) {
	full := make([]VoteOption, OptionLimit)
	for i := range full {
		full[i] = labelOption(int64(i+1), fmt.Sprintf("Choice %d", i), i > 0)
	}
	for _, test := range []struct {
		name   string
		vote   *Vote
		exists bool
		want   error
	}{
		{"new label", &Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true}, false, nil},
		{"existing label", &Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true}, true, nil},
		{"existing label at the limit", &Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true, Options: full}, true, nil},
		{"new label at the limit", &Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true, Options: full}, false, ErrOptionLimit},
		{"last free option", &Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true, Options: full[1:]}, false, nil},
		{"write-ins off", &Vote{Status: VoteOpen, Choices: ChoicesCustom}, true, ErrWriteInsDisabled},
		{"guests vote", &Vote{Status: VoteOpen, Choices: ChoicesGuests}, false, ErrWriteInsDisabled},
		{"closed", &Vote{Status: VoteClosed, Choices: ChoicesCustom, AllowWriteIns: true}, true, ErrVoteClosed},
		{"draft", &Vote{Status: VoteDraft, Choices: ChoicesCustom, AllowWriteIns: true}, false, ErrVoteClosed},
		{"no vote", nil, false, ErrNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := (Event{Vote: test.vote}).CheckWriteIn(test.exists); !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
	closed := Event{Vote: &Vote{Status: VoteClosed, Choices: ChoicesCustom, AllowWriteIns: true, Options: full[:2]}}
	for _, test := range []struct {
		optionID int64
		want     error
	}{{2, nil}, {1, ErrActivityConflict}, {99, ErrInvalidOption}} {
		if err := closed.CheckRemoval(test.optionID); !errors.Is(err, test.want) {
			t.Fatalf("removal of option %d: error=%v want=%v", test.optionID, err, test.want)
		}
	}
	if err := (Event{}).CheckRemoval(1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removal without vote: %v", err)
	}
}

func TestVoteViewTellsWhetherTheViewerCanVote(t *testing.T) {
	choice := int64(11)
	guests := Vote{Status: VoteOpen, Choices: ChoicesGuests, MyOptionID: &choice, Options: []VoteOption{guestOption(10, 1, true), guestOption(11, 2, false)}}
	for _, test := range []struct {
		name    string
		vote    Vote
		guestID int64
		want    bool
	}{
		{"another active guest", guests, 3, true},
		{"only themselves and a revoked guest", guests, 1, false},
		{"labels", Vote{Status: VoteOpen, Choices: ChoicesCustom, Options: []VoteOption{labelOption(1, "A", false)}}, 1, true},
		{"write-ins without options", Vote{Status: VoteOpen, Choices: ChoicesCustom, AllowWriteIns: true}, 1, true},
		{"no options", Vote{Status: VoteOpen, Choices: ChoicesCustom}, 1, false},
		{"draft", Vote{Status: VoteDraft, Choices: ChoicesCustom, AllowWriteIns: true}, 1, false},
		{"closed", Vote{Status: VoteClosed, Choices: ChoicesCustom, AllowWriteIns: true}, 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			stored := Event{Vote: &test.vote}
			view := stored.VoteView(test.guestID)
			if view.Vote.CanVote != test.want {
				t.Fatalf("canVote=%v want=%v", view.Vote.CanVote, test.want)
			}
			if stored.Vote.CanVote {
				t.Fatal("view changed the stored vote")
			}
		})
	}
	view := (Event{Vote: &guests}).VoteView(3)
	if *view.Vote.MyOptionID != 11 || len(view.Vote.Options) != 2 {
		t.Fatalf("view lost the choice or options: %+v", view.Vote)
	}
}
