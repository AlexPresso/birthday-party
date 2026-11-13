package programme

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/timestamp"
)

// Three bounded queries share a snapshot of event content, candidates and ballots.
func readEvents(ctx context.Context, tx *sql.Tx, eventID int64, limit int, guestID int64, admin bool, now time.Time) ([]programme.Event, error) {
	ordered := []*programme.Event{}
	byVoteID := map[int64]*programme.Event{}
	voteIDs := []int64{}
	rows, err := tx.QueryContext(ctx, `SELECT e.id,e.title,e.description,e.teaser,e.starts_at,e.unlock_at,
 COALESCE(a.id,0),COALESCE(a.type,'event'),COALESCE(a.revision,1),
 COALESCE(v.question,''),COALESCE(v.status,''),COALESCE(v.allow_self_vote,FALSE),
 COALESCE(q.status,''),COALESCE(q.jokers_used,0),
 (SELECT COUNT(*) FROM programme_questions WHERE activity_id=q.activity_id)
 FROM events e LEFT JOIN programme_activities a ON a.event_id=e.id
 LEFT JOIN programme_votes v ON v.activity_id=a.id
 LEFT JOIN programme_question_rounds q ON q.activity_id=a.id
 WHERE ($1::bigint=0 OR e.id=$1) AND ($2 OR (COALESCE(v.status,'')<>'draft' AND COALESCE(q.status,'')<>'draft'))
 ORDER BY e.id LIMIT $3`, eventID, admin, limit)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		event := &programme.Event{}
		var voteID int64
		var startsAt, unlockAt *time.Time
		questions := &programme.QuestionSummary{}
		vote := &programme.Vote{Candidates: []programme.Candidate{}, Results: []programme.VoteResult{}}
		if err := rows.Scan(&event.ID, &event.Title, &event.Description, &event.Teaser, &startsAt, &unlockAt,
			&voteID, &event.Type, &event.Revision, &vote.Question, &vote.Status, &vote.AllowSelfVote,
			&questions.Status, &questions.JokersUsed, &questions.QuestionCount); err != nil {
			rows.Close()
			return nil, err
		}
		event.StartsAt, event.UnlockAt = timestamp.FormatOptional(startsAt), timestamp.FormatOptional(unlockAt)
		*event = event.View(now, admin)
		if event.Type == programme.TypeQuestions && (!event.Locked || admin) {
			event.Questions = questions
		}
		if event.Type == programme.TypeVote && (!event.Locked || admin) {
			count := 0
			vote.ParticipationCount = &count
			event.Vote = vote
			byVoteID[voteID] = event
			voteIDs = append(voteIDs, voteID)
		}
		ordered = append(ordered, event)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(voteIDs) > 0 {
		if err := readCandidates(ctx, tx, voteIDs, byVoteID); err != nil {
			return nil, err
		}
		if err := readBallots(ctx, tx, voteIDs, guestID, byVoteID); err != nil {
			return nil, err
		}
	}
	items := make([]programme.Event, 0, len(ordered))
	for _, event := range ordered {
		items = append(items, event.VoteView(guestID, admin))
	}
	return items, nil
}

func readCandidates(ctx context.Context, tx *sql.Tx, ids []int64, byID map[int64]*programme.Event) error {
	rows, err := tx.QueryContext(ctx, `SELECT c.activity_id,g.id,g.name,g.active,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END
 FROM programme_vote_candidates c JOIN guests g ON g.id=c.guest_id
 WHERE c.activity_id=ANY($1) ORDER BY c.activity_id,c.position`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, version int64
		var candidate programme.Candidate
		if err := rows.Scan(&id, &candidate.ID, &candidate.Name, &candidate.Active, &version); err != nil {
			return err
		}
		candidate.AvatarURL = identity.AvatarURL(candidate.ID, version)
		vote := byID[id].Vote
		vote.Candidates = append(vote.Candidates, candidate)
		vote.Results = append(vote.Results, programme.VoteResult{CandidateID: candidate.ID})
	}
	return rows.Err()
}

func readBallots(ctx context.Context, tx *sql.Tx, ids []int64, guestID int64, byID map[int64]*programme.Event) error {
	rows, err := tx.QueryContext(ctx, `SELECT activity_id,candidate_id,COUNT(*),BOOL_OR(guest_id=$2)
 FROM programme_ballots WHERE activity_id=ANY($1) GROUP BY activity_id,candidate_id`, ids, guestID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, candidateID int64
		var count int
		var own bool
		if err := rows.Scan(&id, &candidateID, &count, &own); err != nil {
			return err
		}
		vote := byID[id].Vote
		*vote.ParticipationCount += count
		if own {
			vote.MyCandidateID = &candidateID
		}
		for i := range vote.Results {
			if vote.Results[i].CandidateID == candidateID {
				vote.Results[i].Votes = count
				break
			}
		}
	}
	return rows.Err()
}

func readEvent(ctx context.Context, tx *sql.Tx, eventID, guestID int64, admin bool, now time.Time) (programme.Event, error) {
	items, err := readEvents(ctx, tx, eventID, 1, guestID, admin, now)
	if err != nil {
		return programme.Event{}, err
	}
	if len(items) == 0 {
		return programme.Event{}, programme.ErrNotFound
	}
	return items[0], nil
}
