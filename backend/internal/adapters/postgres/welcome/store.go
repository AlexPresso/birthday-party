// Package welcome persists atomic welcome commands and shared access snapshots.
package welcome

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"birthday-party/backend/internal/welcome"
)

const Select = "SELECT is_open,revision,current_step,required,generation,steps FROM welcome WHERE id=1"

// AccessSQL and PositionSQL use welcome w and guest_welcome_progress p.
// Keep these predicates shared by adapters that enforce the same access rule.
const AccessSQL = `(w.is_open AND (w.generation=0 OR
 COALESCE(p.generation=w.generation AND p.completed,false) OR
 (NOT w.required AND (p.guest_id IS NULL OR p.generation<>w.generation))))`

const PositionSQL = `(p.generation=w.generation AND NOT p.completed
 AND p.position>0 AND p.position<=w.current_step)`

type Store struct {
	db      *sql.DB
	enqueue func(context.Context, *sql.Tx, welcome.State, welcome.Action) error
}

func New(db *sql.DB, enqueue func(context.Context, *sql.Tx, welcome.State, welcome.Action) error) *Store {
	return &Store{db: db, enqueue: enqueue}
}

var _ welcome.Repository = (*Store)(nil)

func Scan(row *sql.Row) (welcome.State, error) {
	var state welcome.State
	var steps []byte
	if err := row.Scan(&state.Open, &state.Revision, &state.CurrentStep, &state.Required, &state.Generation, &steps); err != nil {
		return state, err
	}
	err := json.Unmarshal(steps, &state.Steps)
	return state, err
}

func (s *Store) State(ctx context.Context) (welcome.State, error) {
	return Scan(s.db.QueryRowContext(ctx, Select))
}

func (s *Store) lock(ctx context.Context) (*sql.Tx, welcome.State, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, welcome.State{}, err
	}
	state, err := Scan(tx.QueryRowContext(ctx, Select+" FOR UPDATE"))
	if err != nil {
		tx.Rollback()
		return nil, state, err
	}
	return tx, state, nil
}

func save(ctx context.Context, tx *sql.Tx, state *welcome.State) error {
	steps, err := json.Marshal(state.Steps)
	if err != nil {
		return err
	}
	state.Revision++
	_, err = tx.ExecContext(ctx, "UPDATE welcome SET is_open=$1,revision=$2,current_step=$3,steps=$4,required=$5,generation=$6 WHERE id=1", state.Open, state.Revision, state.CurrentStep, steps, state.Required, state.Generation)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Edit(ctx context.Context, revision int64, steps []welcome.Step) (welcome.State, error) {
	tx, state, err := s.lock(ctx)
	if err != nil {
		return state, err
	}
	defer tx.Rollback()
	previous := state
	state, err = welcome.Edit(state, revision, steps)
	if err != nil {
		return state, err
	}
	// The welcome lock excludes navigation and widget writes. Update positions
	// in ascending order so guests clamped backward are never processed twice.
	for position := 1; position <= previous.CurrentStep; position++ {
		progress, changed := welcome.ReconcileProgress(previous, state, welcome.Progress{
			Generation: previous.Generation,
			Position:   position,
		})
		if !changed {
			continue
		}
		_, err = tx.ExecContext(ctx, `UPDATE guest_welcome_progress
 SET position=$1,revision=nextval('welcome_progress_revision_seq')
 WHERE generation=$2 AND position=$3 AND NOT completed`, progress.Position, previous.Generation, position)
		if err != nil {
			return state, err
		}
	}
	for _, step := range steps {
		for _, widget := range step.Widgets {
			if widget.MediaUpload == nil || widget.MediaUpload.CategoryID == nil {
				continue
			}
			var id int64
			err = tx.QueryRowContext(ctx, "SELECT id FROM media_categories WHERE id=$1 FOR SHARE", *widget.MediaUpload.CategoryID).Scan(&id)
			if errors.Is(err, sql.ErrNoRows) {
				return state, welcome.ErrCategoryNotFound
			}
			if err != nil {
				return state, err
			}
		}
	}
	err = save(ctx, tx, &state)
	return state, err
}

func (s *Store) Transition(ctx context.Context, revision int64, action welcome.Action) (welcome.State, error) {
	tx, state, err := s.lock(ctx)
	if err != nil {
		return state, err
	}
	defer tx.Rollback()
	state, err = welcome.Transition(state, revision, action)
	if err != nil {
		return state, err
	}
	if err = s.enqueue(ctx, tx, state, action); err != nil {
		return state, err
	}
	err = save(ctx, tx, &state)
	return state, err
}

func (s *Store) SetRequired(ctx context.Context, revision int64, required bool) (welcome.State, error) {
	tx, state, err := s.lock(ctx)
	if err != nil {
		return state, err
	}
	defer tx.Rollback()
	if err = welcome.CheckRevision(state, revision); err != nil {
		return state, err
	}
	state.Required = required
	err = save(ctx, tx, &state)
	return state, err
}

func readProgress(ctx context.Context, tx *sql.Tx, guestID int64, lock string) (welcome.Progress, error) {
	var progress welcome.Progress
	err := tx.QueryRowContext(ctx, "SELECT generation,position,revision,completed FROM guest_welcome_progress WHERE guest_id=$1"+lock, guestID).
		Scan(&progress.Generation, &progress.Position, &progress.Revision, &progress.Completed)
	if errors.Is(err, sql.ErrNoRows) {
		return progress, nil
	}
	return progress, err
}

func (s *Store) Enroll(ctx context.Context, guestID int64) (welcome.State, welcome.Progress, error) {
	var state welcome.State
	var progress welcome.Progress
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return state, progress, err
	}
	defer tx.Rollback()
	// Enrollment's foreign key takes a guest lock, before welcome and progress.
	var id int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM guests WHERE id=$1 FOR KEY SHARE", guestID).Scan(&id); err != nil {
		return state, progress, err
	}
	state, err = Scan(tx.QueryRowContext(ctx, Select+" FOR SHARE"))
	if err != nil {
		return state, progress, err
	}
	if state.Generation != 0 {
		initial := welcome.InitialProgress(state)
		_, err = tx.ExecContext(ctx, `INSERT INTO guest_welcome_progress(guest_id,generation,position,completed)
 VALUES($1,$2,$3,$4) ON CONFLICT(guest_id) DO UPDATE
 SET generation=excluded.generation,position=excluded.position,completed=excluded.completed,
 revision=nextval('welcome_progress_revision_seq')
 WHERE guest_welcome_progress.generation<>excluded.generation`, guestID, initial.Generation, initial.Position, initial.Completed)
		if err != nil {
			return state, progress, err
		}
		progress, err = readProgress(ctx, tx, guestID, " FOR UPDATE")
		if err != nil {
			return state, progress, err
		}
		var entered bool
		progress, entered = welcome.EnterFirstStep(state, progress)
		if entered {
			err = tx.QueryRowContext(ctx, `UPDATE guest_welcome_progress
 SET position=$1,revision=nextval('welcome_progress_revision_seq')
 WHERE guest_id=$2 RETURNING revision`, progress.Position, guestID).Scan(&progress.Revision)
			if err != nil {
				return state, progress, err
			}
		}
	}
	return state, progress, tx.Commit()
}

func (s *Store) Navigate(ctx context.Context, guestID, revision int64, action welcome.Action) (welcome.State, welcome.Progress, error) {
	var state welcome.State
	var progress welcome.Progress
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return state, progress, err
	}
	defer tx.Rollback()
	state, err = Scan(tx.QueryRowContext(ctx, Select+" FOR SHARE"))
	if err != nil {
		return state, progress, err
	}
	progress, err = readProgress(ctx, tx, guestID, " FOR UPDATE")
	if err != nil {
		return state, progress, err
	}
	progress, err = welcome.Navigate(state, progress, revision, action)
	if err != nil {
		return state, progress, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE guest_welcome_progress
 SET position=$1,completed=$2,revision=nextval('welcome_progress_revision_seq')
 WHERE guest_id=$3 RETURNING revision`, progress.Position, progress.Completed, guestID).Scan(&progress.Revision)
	if err != nil {
		return state, progress, err
	}
	return state, progress, tx.Commit()
}

// CurrentGuest locks sequence before progress. Upload/profile callers already
// hold guest and session locks so authorization remains atomic with persistence.
func CurrentGuest(ctx context.Context, tx *sql.Tx, guestID int64) (welcome.View, error) {
	state, err := Scan(tx.QueryRowContext(ctx, Select+" FOR SHARE"))
	if err != nil {
		return welcome.View{}, err
	}
	progress, err := readProgress(ctx, tx, guestID, " FOR SHARE")
	if err != nil {
		return welcome.View{}, err
	}
	return welcome.GuestView(state, progress), nil
}
