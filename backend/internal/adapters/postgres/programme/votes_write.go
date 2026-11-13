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

func (s *Store) createVote(ctx context.Context, tx *sql.Tx, eventID int64, input programme.VoteInput) error {
	var id int64
	err := tx.QueryRowContext(ctx, "INSERT INTO programme_activities(event_id,type) VALUES($1,'vote') RETURNING id", eventID).Scan(&id)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO programme_votes(activity_id,question,choices,allow_self_vote,allow_write_ins)
 VALUES($1,$2,$3,$4,$5)`, id, input.Question, string(input.Choices), input.AllowSelfVote, input.AllowWriteIns)
	if err != nil {
		return err
	}
	return s.replaceOptions(ctx, tx, id, input)
}

// replaceOptions saves the host's options in the order given. Only a draft
// has its options replaced, so no ballot refers to the removed ones.
func (s *Store) replaceOptions(ctx context.Context, tx *sql.Tx, id int64, input programme.VoteInput) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM programme_vote_options WHERE activity_id=$1", id); err != nil {
		return err
	}
	if input.Choices == programme.ChoicesGuests {
		return s.insertGuestOptions(ctx, tx, id, input.CandidateIDs)
	}
	return s.insertLabelOptions(ctx, tx, id, input.Labels)
}

// insertGuestOptions relies on the candidates' guest locks held since begin.
func (s *Store) insertGuestOptions(ctx context.Context, tx *sql.Tx, id int64, guestIDs []int64) error {
	var active int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM guests WHERE id=ANY($1) AND active", guestIDs).Scan(&active); err != nil {
		return err
	}
	if active != len(guestIDs) {
		return programme.ErrInvalidOption
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO programme_vote_options(activity_id,guest_id,created_at)
 SELECT $1,guest_id,$3::timestamptz FROM unnest($2::bigint[]) WITH ORDINALITY AS candidate(guest_id,position)
 ORDER BY position`, id, guestIDs, s.now())
	return err
}

// insertLabelOptions lets the unique index decide which labels are the same:
// a label it refuses is a duplicate the core rule did not recognize.
func (s *Store) insertLabelOptions(ctx context.Context, tx *sql.Tx, id int64, labels []string) error {
	result, err := tx.ExecContext(ctx, `INSERT INTO programme_vote_options(activity_id,label,created_at)
 SELECT $1,label,$3::timestamptz FROM unnest($2::text[]) WITH ORDINALITY AS host(label,position)
 ORDER BY position ON CONFLICT DO NOTHING`, id, labels, s.now())
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if inserted != int64(len(labels)) {
		return programme.ErrInvalidActivity
	}
	return nil
}

func lockVote(ctx context.Context, tx *sql.Tx, eventID int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM programme_activities WHERE event_id=$1 FOR UPDATE", eventID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, programme.ErrNotFound
	}
	return id, err
}

// updateVote saves the question and, for a draft, the other settings and the
// options. CheckEdit has already refused any other change to an opened vote.
func (s *Store) updateVote(ctx context.Context, tx *sql.Tx, event programme.Event, input programme.VoteInput) error {
	id, err := lockVote(ctx, tx, event.ID)
	if err != nil {
		return err
	}
	if event.Vote.Status != programme.VoteDraft {
		_, err = tx.ExecContext(ctx, "UPDATE programme_votes SET question=$1 WHERE activity_id=$2", input.Question, id)
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE programme_votes SET question=$1,choices=$2,allow_self_vote=$3,allow_write_ins=$4
 WHERE activity_id=$5`, input.Question, string(input.Choices), input.AllowSelfVote, input.AllowWriteIns, id)
	if err != nil {
		return err
	}
	return s.replaceOptions(ctx, tx, id, input)
}

// voteTransaction authorizes the actor and locks the event's vote. The vote
// lock serializes the ballots, write-ins, removals and transitions of one
// vote, so the returned state stays current until the transaction ends.
func (s *Store) voteTransaction(ctx context.Context, actor programme.Actor, eventID int64, admin bool, candidateIDs []int64) (*transaction, int64, programme.Event, error) {
	tx, err := s.begin(ctx, actor, eventID, admin, candidateIDs)
	if err != nil {
		return nil, 0, programme.Event{}, err
	}
	id, err := lockVote(ctx, tx.Tx, eventID)
	if err != nil {
		tx.Rollback()
		return nil, 0, programme.Event{}, err
	}
	event, err := readEvent(ctx, tx.Tx, eventID, actor.GuestID, admin, s.now())
	if err != nil {
		tx.Rollback()
		return nil, 0, programme.Event{}, err
	}
	return tx, id, event, nil
}

func (s *Store) TransitionVote(ctx context.Context, actor programme.Actor, eventID int64, status programme.VoteStatus, revision int64) (programme.Event, error) {
	tx, id, event, err := s.voteTransaction(ctx, actor, eventID, true, nil)
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
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

func (s *Store) CastVote(ctx context.Context, actor programme.Actor, eventID, optionID int64) (programme.Event, error) {
	candidateIDs, err := s.optionGuest(ctx, optionID)
	if err != nil {
		return programme.Event{}, err
	}
	tx, id, event, err := s.voteTransaction(ctx, actor, eventID, false, candidateIDs)
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	if err := event.CheckBallot(actor.GuestID, optionID); err != nil {
		return programme.Event{}, err
	}
	return s.recordBallot(ctx, tx, actor, eventID, id, optionID)
}

// optionGuest names the guest an option stands for, if any, so begin can lock
// that guest in order. An option never changes guest, and the ballot is still
// checked against the vote's options under the vote lock.
func (s *Store) optionGuest(ctx context.Context, optionID int64) ([]int64, error) {
	var guestID int64
	err := s.db.QueryRowContext(ctx, "SELECT guest_id FROM programme_vote_options WHERE id=$1 AND guest_id IS NOT NULL", optionID).Scan(&guestID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []int64{guestID}, nil
}

// CastWriteIn lets the unique label index decide whether the label already
// has an option. Under the vote lock, two guests typing the same new label
// create it once and both vote for it.
func (s *Store) CastWriteIn(ctx context.Context, actor programme.Actor, eventID int64, label string) (programme.Event, error) {
	tx, id, event, err := s.voteTransaction(ctx, actor, eventID, false, nil)
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	var optionID int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM programme_vote_options WHERE activity_id=$1 AND lower(label)=lower($2)", id, label).Scan(&optionID)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return programme.Event{}, err
	}
	if err := event.CheckWriteIn(exists); err != nil {
		return programme.Event{}, err
	}
	if !exists {
		err := tx.QueryRowContext(ctx, `INSERT INTO programme_vote_options(activity_id,label,write_in,created_at)
 VALUES($1,$2,TRUE,$3) RETURNING id`, id, label, s.now()).Scan(&optionID)
		if err != nil {
			return programme.Event{}, err
		}
	}
	return s.recordBallot(ctx, tx, actor, eventID, id, optionID)
}

// recordBallot replaces the actor's choice in the locked vote. A write-in
// that loses its last vote disappears in the same transaction.
func (s *Store) recordBallot(ctx context.Context, tx *transaction, actor programme.Actor, eventID, voteID, optionID int64) (programme.Event, error) {
	_, err := tx.ExecContext(ctx, `INSERT INTO programme_ballots(activity_id,guest_id,option_id) VALUES($1,$2,$3)
 ON CONFLICT(activity_id,guest_id) DO UPDATE SET option_id=excluded.option_id`, voteID, actor.GuestID, optionID)
	if err != nil {
		return programme.Event{}, err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM programme_vote_options o WHERE o.activity_id=$1 AND o.write_in
 AND NOT EXISTS (SELECT 1 FROM programme_ballots b WHERE b.activity_id=o.activity_id AND b.option_id=o.id)`, voteID)
	if err != nil {
		return programme.Event{}, err
	}
	return s.finish(ctx, tx, actor, eventID, false)
}

// RemoveVoteOption deletes a write-in; its ballots go with it.
func (s *Store) RemoveVoteOption(ctx context.Context, actor programme.Actor, eventID, optionID int64) (programme.Event, error) {
	tx, id, event, err := s.voteTransaction(ctx, actor, eventID, true, nil)
	if err != nil {
		return programme.Event{}, err
	}
	defer tx.Rollback()
	if err := event.CheckRemoval(optionID); err != nil {
		return programme.Event{}, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM programme_vote_options WHERE activity_id=$1 AND id=$2", id, optionID); err != nil {
		return programme.Event{}, err
	}
	return s.finish(ctx, tx, actor, eventID, true)
}

// finish reads the saved event for the response and commits.
func (s *Store) finish(ctx context.Context, tx *transaction, actor programme.Actor, eventID int64, admin bool) (programme.Event, error) {
	event, err := readEvent(ctx, tx.Tx, eventID, actor.GuestID, admin, s.now())
	if err != nil {
		return programme.Event{}, err
	}
	return event, s.commit(tx)
}
