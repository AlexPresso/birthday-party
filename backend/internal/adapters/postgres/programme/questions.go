package programme

import (
	"context"
	"database/sql"
	"errors"

	"birthday-party/backend/internal/programme"
)

var _ programme.QuestionRepository = (*Store)(nil)

func (s *Store) questionTransaction(ctx context.Context, actor programme.Actor, eventID int64, admin, write bool) (*sql.Tx, int64, programme.QuestionRound, error) {
	tx, err := s.begin(ctx, actor, eventID, admin, nil)
	if err != nil {
		return nil, 0, programme.QuestionRound{}, err
	}
	lock := " FOR SHARE OF a,q"
	if write {
		lock = " FOR UPDATE OF a,q"
	}
	var id int64
	var round programme.QuestionRound
	err = tx.QueryRowContext(ctx, `SELECT a.id,a.revision,q.status,q.jokers_used
 FROM programme_activities a JOIN programme_question_rounds q ON q.activity_id=a.id
 WHERE a.event_id=$1`+lock, eventID).Scan(&id, &round.Revision, &round.Status, &round.JokersUsed)
	if errors.Is(err, sql.ErrNoRows) || err == nil && !admin && round.Status == "draft" {
		err = programme.ErrNotFound
	}
	if err != nil {
		tx.Rollback()
		return nil, 0, round, err
	}
	return tx, id, round, nil
}

func (s *Store) finishQuestions(ctx context.Context, tx *sql.Tx, actor programme.Actor, id int64) (programme.QuestionRound, error) {
	round := programme.QuestionRound{Items: []programme.Question{}}
	err := tx.QueryRowContext(ctx, `SELECT a.revision,q.status,q.jokers_used FROM programme_activities a
 JOIN programme_question_rounds q ON q.activity_id=a.id WHERE a.id=$1`, id).Scan(&round.Revision, &round.Status, &round.JokersUsed)
	if err != nil {
		return round, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT q.id,q.body,q.status,COUNT(v.guest_id),COALESCE(BOOL_OR(v.guest_id=$2),FALSE)
 FROM programme_questions q LEFT JOIN programme_question_upvotes v ON v.question_id=q.id
 WHERE q.activity_id=$1 GROUP BY q.id
 ORDER BY (q.status='pending') DESC,COUNT(v.guest_id) DESC,q.id LIMIT $3`, id, actor.GuestID, programme.QuestionLimit)
	if err != nil {
		return round, err
	}
	for rows.Next() {
		var question programme.Question
		if err := rows.Scan(&question.ID, &question.Body, &question.Status, &question.Votes, &question.Upvoted); err != nil {
			rows.Close()
			return round, err
		}
		round.Items = append(round.Items, question)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return round, err
	}
	round.QuestionCount = len(round.Items)
	if err := s.checkExpiry(ctx, tx, actor); err != nil {
		return round, err
	}
	return round, tx.Commit()
}

func (s *Store) ReadQuestions(ctx context.Context, actor programme.Actor, eventID int64, admin bool) (programme.QuestionRound, error) {
	tx, id, _, err := s.questionTransaction(ctx, actor, eventID, admin, false)
	if err != nil {
		return programme.QuestionRound{}, err
	}
	defer tx.Rollback()
	return s.finishQuestions(ctx, tx, actor, id)
}

func (s *Store) AddQuestion(ctx context.Context, actor programme.Actor, eventID int64, body string, limit int) (programme.QuestionRound, error) {
	tx, id, round, err := s.questionTransaction(ctx, actor, eventID, false, true)
	if err != nil {
		return round, err
	}
	defer tx.Rollback()
	if round.Status != "open" {
		return round, programme.ErrQuestionsClosed
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM programme_questions WHERE activity_id=$1", id).Scan(&count); err != nil {
		return round, err
	}
	if count >= limit {
		return round, programme.ErrQuestionLimit
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO programme_questions(activity_id,guest_id,body) VALUES($1,$2,$3)", id, actor.GuestID, body); err != nil {
		return round, err
	}
	return s.finishQuestions(ctx, tx, actor, id)
}

func (s *Store) UpvoteQuestion(ctx context.Context, actor programme.Actor, eventID, questionID int64, upvoted bool) (programme.QuestionRound, error) {
	tx, id, round, err := s.questionTransaction(ctx, actor, eventID, false, true)
	if err != nil {
		return round, err
	}
	defer tx.Rollback()
	if round.Status != "open" {
		return round, programme.ErrQuestionsClosed
	}
	status, err := questionStatus(ctx, tx, id, questionID)
	if err != nil {
		return round, err
	}
	if status != "pending" {
		return round, programme.ErrActivityConflict
	}
	if upvoted {
		_, err = tx.ExecContext(ctx, "INSERT INTO programme_question_upvotes(question_id,guest_id) VALUES($1,$2) ON CONFLICT DO NOTHING", questionID, actor.GuestID)
	} else {
		_, err = tx.ExecContext(ctx, "DELETE FROM programme_question_upvotes WHERE question_id=$1 AND guest_id=$2", questionID, actor.GuestID)
	}
	if err != nil {
		return round, err
	}
	return s.finishQuestions(ctx, tx, actor, id)
}

func (s *Store) TransitionQuestions(ctx context.Context, actor programme.Actor, eventID int64, status string, revision int64) (programme.QuestionRound, error) {
	tx, id, round, err := s.questionTransaction(ctx, actor, eventID, true, true)
	if err != nil {
		return round, err
	}
	defer tx.Rollback()
	if err := round.CheckTransition(status, revision); err != nil {
		return round, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_question_rounds SET status=$1 WHERE activity_id=$2", status, id); err != nil {
		return round, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_activities SET revision=revision+1 WHERE id=$1", id); err != nil {
		return round, err
	}
	return s.finishQuestions(ctx, tx, actor, id)
}

func questionStatus(ctx context.Context, tx *sql.Tx, activityID, questionID int64) (string, error) {
	var status string
	err := tx.QueryRowContext(ctx, "SELECT status FROM programme_questions WHERE id=$1 AND activity_id=$2", questionID, activityID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		err = programme.ErrNotFound
	}
	return status, err
}

func (s *Store) ResolveQuestion(ctx context.Context, actor programme.Actor, eventID, questionID int64, status string, revision int64) (programme.QuestionRound, error) {
	tx, id, round, err := s.questionTransaction(ctx, actor, eventID, true, true)
	if err != nil {
		return round, err
	}
	defer tx.Rollback()
	current, err := questionStatus(ctx, tx, id, questionID)
	if err != nil {
		return round, err
	}
	if err := round.CheckResolution(current, status, revision); err != nil {
		return round, err
	}
	if status == "joker" {
		if _, err := tx.ExecContext(ctx, "UPDATE programme_question_rounds SET jokers_used=jokers_used+1 WHERE activity_id=$1", id); err != nil {
			return round, err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_questions SET status=$1 WHERE id=$2", status, questionID); err != nil {
		return round, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_activities SET revision=revision+1 WHERE id=$1", id); err != nil {
		return round, err
	}
	return s.finishQuestions(ctx, tx, actor, id)
}
