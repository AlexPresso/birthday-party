package programme

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"birthday-party/backend/internal/access"
	pgaccess "birthday-party/backend/internal/adapters/postgres/access"
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/timestamp"
)

// transaction is an authorized programme transaction. It holds the actor's
// guest and session locks, so revocation and logout wait until it ends.
type transaction struct {
	*sql.Tx
	session pgaccess.Session
}

// begin locks guest identities in ID order, then session, welcome, event and
// vote. Candidate locks make revocation atomic with accepting a ballot or a
// new list.
func (s *Store) begin(ctx context.Context, actor programme.Actor, eventID int64, admin bool, candidateIDs []int64) (*transaction, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	session, err := s.authorize(ctx, tx, actor, admin, candidateIDs)
	if err == nil && eventID != 0 {
		err = s.lockEvent(ctx, tx, eventID, admin)
	}
	if err != nil {
		tx.Rollback()
		return nil, err
	}
	return &transaction{Tx: tx, session: session}, nil
}

// lockEvent holds the event for the transaction. Guests only reach unlocked events.
func (s *Store) lockEvent(ctx context.Context, tx *sql.Tx, eventID int64, admin bool) error {
	lock := " FOR SHARE"
	if admin {
		lock = " FOR UPDATE"
	}
	var unlock *time.Time
	err := tx.QueryRowContext(ctx, "SELECT unlock_at FROM events WHERE id=$1"+lock, eventID).Scan(&unlock)
	if errors.Is(err, sql.ErrNoRows) {
		return programme.ErrNotFound
	}
	if err != nil {
		return err
	}
	if !admin && (programme.Event{UnlockAt: timestamp.FormatOptional(unlock)}).View(s.now(), false).Locked {
		return programme.ErrNotFound
	}
	return nil
}

func (s *Store) authorize(ctx context.Context, tx *sql.Tx, actor programme.Actor, admin bool, candidateIDs []int64) (pgaccess.Session, error) {
	ids := append(slices.Clone(candidateIDs), actor.GuestID)
	rows, err := tx.QueryContext(ctx, "SELECT id,name,role,active FROM guests WHERE id=ANY($1) ORDER BY id FOR SHARE", ids)
	if err != nil {
		return pgaccess.Session{}, err
	}
	var viewer identity.Guest
	for rows.Next() {
		var guest identity.Guest
		if err := rows.Scan(&guest.ID, &guest.Name, &guest.Role, &guest.Active); err != nil {
			rows.Close()
			return pgaccess.Session{}, err
		}
		if guest.ID == actor.GuestID {
			viewer = guest
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return pgaccess.Session{}, err
	}
	rows.Close()
	if !viewer.Active {
		return pgaccess.Session{}, access.ErrExpired
	}
	session, err := pgaccess.LockSession(ctx, tx, actor.GuestID, actor.SessionHash)
	if err != nil {
		return session, err
	}
	if !session.ValidAt(s.now()) {
		return session, access.ErrExpired
	}
	if admin {
		return session, access.Check(access.Snapshot{Guest: viewer}, access.Request{Admin: true, Scope: access.Session})
	}
	view, err := pgwelcome.CurrentGuest(ctx, tx, viewer.ID)
	if err != nil {
		return session, err
	}
	return session, access.Check(access.Snapshot{Guest: viewer, Open: view.Open}, access.Request{Scope: access.Party})
}

// commit ends an authorized transaction. Guest and session locks have excluded
// revocation and logout since begin; the clock is checked again here because
// waits on the welcome, event and vote locks can outlast the session.
func (s *Store) commit(tx *transaction) error {
	if !tx.session.ValidAt(s.now()) {
		return access.ErrExpired
	}
	return tx.Commit()
}

func createVote(ctx context.Context, tx *sql.Tx, eventID int64, input programme.VoteInput) error {
	var id int64
	err := tx.QueryRowContext(ctx, "INSERT INTO programme_activities(event_id,type) VALUES($1,'vote') RETURNING id", eventID).Scan(&id)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO programme_votes(activity_id,question,allow_self_vote) VALUES($1,$2,$3)", id, input.Question, input.AllowSelfVote); err != nil {
		return err
	}
	return replaceCandidates(ctx, tx, id, input.CandidateIDs)
}

func replaceCandidates(ctx context.Context, tx *sql.Tx, id int64, ids []int64) error {
	var active int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM guests WHERE id=ANY($1) AND active", ids).Scan(&active); err != nil {
		return err
	}
	if active != len(ids) {
		return programme.ErrInvalidCandidate
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM programme_vote_candidates WHERE activity_id=$1", id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO programme_vote_candidates(activity_id,guest_id,position)
 SELECT $1,id,ordinality-1 FROM unnest($2::bigint[]) WITH ORDINALITY AS candidate(id,ordinality)`, id, ids)
	return err
}

func lockVote(ctx context.Context, tx *sql.Tx, eventID int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM programme_activities WHERE event_id=$1 FOR UPDATE", eventID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, programme.ErrNotFound
	}
	return id, err
}

func updateVote(ctx context.Context, tx *sql.Tx, event programme.Event, input programme.VoteInput) error {
	id, err := lockVote(ctx, tx, event.ID)
	if err != nil {
		return err
	}
	if event.Vote.Status == programme.VoteDraft {
		if err := replaceCandidates(ctx, tx, id, input.CandidateIDs); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, "UPDATE programme_votes SET question=$1,allow_self_vote=$2 WHERE activity_id=$3", input.Question, input.AllowSelfVote, id)
	return err
}

func (s *Store) TransitionVote(ctx context.Context, actor programme.Actor, eventID int64, status programme.VoteStatus, revision int64) (programme.Event, error) {
	tx, err := s.begin(ctx, actor, eventID, true, nil)
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	id, err := lockVote(ctx, tx.Tx, eventID)
	if err != nil {
		return programme.Event{}, err
	}
	event, err := readEvent(ctx, tx.Tx, eventID, actor.GuestID, true, s.now())
	if err != nil {
		return programme.Event{}, err
	}
	if err := event.CheckTransition(status, revision); err != nil {
		return programme.Event{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_votes SET status=$1 WHERE activity_id=$2", string(status), id); err != nil {
		return programme.Event{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE programme_activities SET revision=revision+1 WHERE id=$1", id); err != nil {
		return programme.Event{}, err
	}
	return s.finish(ctx, tx, actor, eventID, true)
}

func (s *Store) CastVote(ctx context.Context, actor programme.Actor, eventID, candidateID int64) (programme.Event, error) {
	tx, err := s.begin(ctx, actor, eventID, false, []int64{candidateID})
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	id, err := lockVote(ctx, tx.Tx, eventID)
	if err != nil {
		return programme.Event{}, err
	}
	event, err := readEvent(ctx, tx.Tx, eventID, actor.GuestID, false, s.now())
	if err != nil {
		return programme.Event{}, err
	}
	if err := event.CheckBallot(actor.GuestID, candidateID); err != nil {
		return programme.Event{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO programme_ballots(activity_id,guest_id,candidate_id) VALUES($1,$2,$3)
 ON CONFLICT(activity_id,guest_id) DO UPDATE SET candidate_id=excluded.candidate_id`, id, actor.GuestID, candidateID)
	if err != nil {
		return programme.Event{}, err
	}
	return s.finish(ctx, tx, actor, eventID, false)
}

// finish reads the saved event for the response and commits.
func (s *Store) finish(ctx context.Context, tx *transaction, actor programme.Actor, eventID int64, admin bool) (programme.Event, error) {
	event, err := readEvent(ctx, tx.Tx, eventID, actor.GuestID, admin, s.now())
	if err != nil {
		return programme.Event{}, err
	}
	return event, s.commit(tx)
}
