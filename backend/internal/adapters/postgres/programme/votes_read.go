package programme

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/timestamp"
)

// Two bounded queries share a snapshot of event content, options and ballots.
func readEvents(ctx context.Context, tx *sql.Tx, eventID int64, limit int, guestID int64, admin bool, now time.Time) ([]programme.Event, error) {
	ordered := []*programme.Event{}
	byVoteID := map[int64]*programme.Event{}
	voteIDs := []int64{}
	rows, err := tx.QueryContext(ctx, `SELECT e.id,e.title,e.description,e.teaser,e.starts_at,e.unlock_at,
 COALESCE(a.id,0),COALESCE(a.type,'event'),COALESCE(a.revision,1),
 COALESCE(v.question,''),COALESCE(v.status,''),COALESCE(v.choices,''),
 COALESCE(v.allow_self_vote,FALSE),COALESCE(v.allow_write_ins,FALSE),
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
		vote := &programme.Vote{Options: []programme.VoteOption{}}
		if err := rows.Scan(&event.ID, &event.Title, &event.Description, &event.Teaser, &startsAt, &unlockAt,
			&voteID, &event.Type, &event.Revision,
			&vote.Question, &vote.Status, &vote.Choices, &vote.AllowSelfVote, &vote.AllowWriteIns,
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
		if err := readOptions(ctx, tx, voteIDs, guestID, byVoteID); err != nil {
			return nil, err
		}
	}
	items := make([]programme.Event, 0, len(ordered))
	for _, event := range ordered {
		items = append(items, event.VoteView(guestID))
	}
	return items, nil
}

// readOptions fills each vote with its options, most voted first, and with
// the viewer's own choice. Voters are only ever counted.
func readOptions(ctx context.Context, tx *sql.Tx, voteIDs []int64, guestID int64, byVoteID map[int64]*programme.Event) error {
	rows, err := tx.QueryContext(ctx, `SELECT o.activity_id,o.id,COALESCE(o.label,g.name),o.guest_id,COALESCE(g.active,TRUE),
 CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END,
 o.write_in,COALESCE(b.votes,0),COALESCE(b.own,FALSE)
 FROM programme_vote_options o
 LEFT JOIN guests g ON g.id=o.guest_id
 LEFT JOIN (
  SELECT activity_id,option_id,COUNT(*) AS votes,BOOL_OR(guest_id=$2) AS own
  FROM programme_ballots WHERE activity_id=ANY($1) GROUP BY activity_id,option_id
 ) b ON b.activity_id=o.activity_id AND b.option_id=o.id
 WHERE o.activity_id=ANY($1)
 ORDER BY o.activity_id,COALESCE(b.votes,0) DESC,lower(COALESCE(o.label,g.name)),o.id`, voteIDs, guestID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var voteID, avatarVersion int64
		var option programme.VoteOption
		var own bool
		if err := rows.Scan(&voteID, &option.ID, &option.Label, &option.GuestID, &option.Active,
			&avatarVersion, &option.WriteIn, &option.Votes, &own); err != nil {
			return err
		}
		if option.GuestID != nil {
			option.AvatarURL = identity.AvatarURL(*option.GuestID, avatarVersion)
		}
		vote := byVoteID[voteID].Vote
		vote.Options = append(vote.Options, option)
		if own {
			vote.MyOptionID = &option.ID
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
