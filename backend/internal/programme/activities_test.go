package programme

import (
	"errors"
	"strings"
	"testing"
)

func TestVoteEventValidationAndFrozenSettings(t *testing.T) {
	valid := Input{Title: "Vote", Type: "vote", Revision: 3, Vote: &VoteInput{Question: "  Best costume?  ", CandidateIDs: []int64{1, 2}}}
	input, err := valid.normalize()
	if err != nil || input.Vote.Question != "Best costume?" || valid.Vote.Question != "  Best costume?  " {
		t.Fatalf("normalization=%+v error=%v", input, err)
	}
	for _, input := range []Input{
		{Title: "Vote", Type: "vote", Vote: &VoteInput{Question: " ", CandidateIDs: []int64{1, 2}}},
		{Title: "Vote", Type: "vote", Vote: &VoteInput{Question: strings.Repeat("x", 241), CandidateIDs: []int64{1, 2}}},
		{Title: "Vote", Type: "vote", Vote: &VoteInput{Question: "Question", CandidateIDs: []int64{1}}},
		{Title: "Vote", Type: "vote", Vote: &VoteInput{Question: "Question", CandidateIDs: []int64{1, 1}}},
		{Title: "Vote", Type: "vote", Vote: &VoteInput{Question: "Question", CandidateIDs: []int64{0, 2}}},
	} {
		if _, err := input.normalize(); !errors.Is(err, ErrInvalidActivity) {
			t.Fatalf("accepted invalid input: %+v error=%v", input, err)
		}
	}
	activity := Event{Title: "Vote", Type: "vote", Revision: 3, Vote: &Vote{Status: "open", Candidates: []Candidate{{ID: 1, Active: true}, {ID: 2, Active: true}}}}
	if err := activity.CheckEdit(input); err != nil {
		t.Fatal(err)
	}
	changed := input
	changed.Vote = &VoteInput{Question: "Corrected", CandidateIDs: []int64{2, 1}}
	if err := activity.CheckEdit(changed); !errors.Is(err, ErrActivityConflict) {
		t.Fatalf("reordered live candidates: %v", err)
	}
	changed.Vote.CandidateIDs = []int64{1, 2}
	changed.Vote.AllowSelfVote = true
	if err := activity.CheckEdit(changed); !errors.Is(err, ErrActivityConflict) {
		t.Fatalf("changed live self-vote: %v", err)
	}
	changed.Revision = 2
	if err := activity.CheckEdit(changed); !errors.Is(err, ErrActivityConflict) {
		t.Fatalf("stale edit: %v", err)
	}
}

func TestVoteLifecycleAndAudiencePrivacy(t *testing.T) {
	count := 2
	choice := int64(2)
	activity := Event{Title: "Vote", Type: "vote", Revision: 4, Vote: &Vote{Status: "open", Candidates: []Candidate{{ID: 1, Active: true}, {ID: 2, Active: true}, {ID: 3}}, ParticipationCount: &count, MyCandidateID: &choice, Results: []VoteResult{{CandidateID: 1, Votes: 1}, {CandidateID: 2, Votes: 1}}}}
	for _, test := range []struct {
		guestID, candidateID int64
		want                 error
	}{{1, 2, nil}, {1, 1, ErrSelfVote}, {1, 3, ErrInvalidCandidate}, {1, 99, ErrInvalidCandidate}} {
		if err := activity.CheckBallot(test.guestID, test.candidateID); !errors.Is(err, test.want) {
			t.Fatalf("ballot error=%v want=%v", err, test.want)
		}
	}
	guest := activity.VoteView(1, false)
	if guest.Vote.Results != nil || guest.Vote.ParticipationCount != nil || !guest.Vote.CanVote || *guest.Vote.MyCandidateID != 2 {
		t.Fatalf("guest privacy: %+v", guest.Vote)
	}
	host := activity.VoteView(1, true)
	if host.Vote.Results != nil || *host.Vote.ParticipationCount != 2 || host.Vote.CanVote {
		t.Fatalf("host privacy: %+v", host.Vote)
	}
	if len(activity.Vote.Results) != 2 || activity.Vote.ParticipationCount == nil {
		t.Fatal("view mutated stored totals")
	}
	if err := activity.CheckTransition("revealed", 4); !errors.Is(err, ErrActivityConflict) {
		t.Fatal("skipped closing")
	}
	if err := activity.CheckTransition("closed", 3); !errors.Is(err, ErrActivityConflict) {
		t.Fatal("accepted stale revision")
	}
	if err := activity.CheckTransition("closed", 4); err != nil {
		t.Fatal(err)
	}
	activity.Vote.Status = "closed"
	if err := activity.CheckBallot(1, 2); !errors.Is(err, ErrVoteClosed) {
		t.Fatal("accepted closed ballot")
	}
	if err := activity.CheckTransition("open", 4); !errors.Is(err, ErrActivityConflict) {
		t.Fatal("reopened closed vote")
	}
	if err := activity.CheckTransition("revealed", 4); err != nil {
		t.Fatal(err)
	}
	activity.Vote.Status = "revealed"
	view := activity.VoteView(1, false)
	if len(view.Vote.Results) != 2 || *view.Vote.ParticipationCount != 2 || view.Vote.CanVote {
		t.Fatalf("revealed=%+v", view.Vote)
	}
}
