package programme

import (
	"context"
	cryptorand "crypto/rand"
	"database/sql"
	"errors"
	"math/rand/v2"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/programme"
)

var _ programme.WerewolfRepository = (*Store)(nil)

// newRandom is the randomness of the deal and of the ghost message draw: a
// ChaCha8 stream seeded from crypto/rand for each use. Roles are secrets, so
// an outcome must not be guessable from earlier ones, which PostgreSQL's
// random() does not promise; and the deal is a core rule, written in Go.
func newRandom() *rand.Rand {
	var seed [32]byte
	// crypto/rand.Read never fails: it stops the program rather than return
	// weak bytes.
	_, _ = cryptorand.Read(seed[:])
	return rand.New(rand.NewChaCha8(seed))
}

func person(id int64, name string, avatarVersion int64) programme.Person {
	return programme.Person{ID: id, Name: name, AvatarURL: identity.AvatarURL(id, avatarVersion)}
}

// createWerewolf adds an empty game with the built-in roles to a new event.
func createWerewolf(ctx context.Context, tx *sql.Tx, eventID int64, settings *programme.WerewolfInput) error {
	var id int64
	err := tx.QueryRowContext(ctx, `WITH activity AS (
 INSERT INTO programme_activities(event_id,type) VALUES($1,'werewolf') RETURNING id)
 INSERT INTO programme_werewolf_games(activity_id) SELECT id FROM activity RETURNING activity_id`, eventID).Scan(&id)
	if err != nil {
		return err
	}
	if err := saveWerewolfRoles(ctx, tx, id, programme.DefaultWerewolfRoles()); err != nil {
		return err
	}
	if settings == nil || settings.GameMasterID == nil {
		return nil
	}
	return setGameMaster(ctx, tx, eventID, settings.GameMasterID)
}

// setGameMaster names the guest who leads the game of an event, or nobody.
// The guest was locked by begin, so they stay active until the commit, and
// the event's update lock keeps every command of the game out. A player who
// becomes game master gives their seat back: the game master does not play.
func setGameMaster(ctx context.Context, tx *sql.Tx, eventID int64, guestID *int64) error {
	if guestID != nil {
		var active bool
		err := tx.QueryRowContext(ctx, "SELECT active FROM guests WHERE id=$1", *guestID).Scan(&active)
		if errors.Is(err, sql.ErrNoRows) || err == nil && !active {
			return programme.ErrInvalidOption
		}
		if err != nil {
			return err
		}
	}
	_, err := tx.ExecContext(ctx, `UPDATE programme_werewolf_games SET game_master_id=$2
 WHERE activity_id=(SELECT id FROM programme_activities WHERE event_id=$1)`, eventID, guestID)
	if err != nil || guestID == nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM programme_werewolf_players WHERE guest_id=$2
 AND activity_id=(SELECT id FROM programme_activities WHERE event_id=$1)`, eventID, *guestID)
	return err
}

// werewolfTransaction authorizes the actor as a guest of the programme,
// whoever they are: full app access and an unlocked event, for the party's
// host too. It then locks the game, which serializes the commands of one
// game, and reads its complete state.
func (s *Store) werewolfTransaction(ctx context.Context, actor programme.Actor, eventID int64, write bool) (*transaction, int64, programme.WerewolfGame, error) {
	tx, err := s.begin(ctx, actor, eventID, false, nil)
	if err != nil {
		return nil, 0, programme.WerewolfGame{}, err
	}
	lock := " FOR SHARE OF a,w"
	if write {
		lock = " FOR UPDATE OF a,w"
	}
	var id int64
	err = tx.QueryRowContext(ctx, `SELECT a.id FROM programme_activities a
 JOIN programme_werewolf_games w ON w.activity_id=a.id WHERE a.event_id=$1`+lock, eventID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		err = programme.ErrNotFound
	}
	var game programme.WerewolfGame
	if err == nil {
		game, err = readWerewolfGame(ctx, tx.Tx, id)
	}
	if err != nil {
		tx.Rollback()
		return nil, 0, game, err
	}
	return tx, id, game, nil
}

// readWerewolfGame reads the complete state of a locked game. Its limits
// repeat the bounds the commands enforce.
func readWerewolfGame(ctx context.Context, tx *sql.Tx, id int64) (programme.WerewolfGame, error) {
	var game programme.WerewolfGame
	var masterID *int64
	var masterName string
	var masterAvatar int64
	err := tx.QueryRowContext(ctx, `SELECT a.revision,w.status,w.phase,w.hide_roles_of_dead,w.ghost_messages,
 w.game_master_id,COALESCE(g.name,''),CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END
 FROM programme_activities a JOIN programme_werewolf_games w ON w.activity_id=a.id
 LEFT JOIN guests g ON g.id=w.game_master_id WHERE a.id=$1`, id).Scan(&game.Revision, &game.Status, &game.Phase,
		&game.HideRolesOfDead, &game.GhostMessages, &masterID, &masterName, &masterAvatar)
	if err != nil {
		return game, err
	}
	if masterID != nil {
		master := person(*masterID, masterName, masterAvatar)
		game.GameMaster = &master
	}
	if game.Roles, err = readWerewolfRoles(ctx, tx, id); err != nil {
		return game, err
	}
	if game.Players, err = readWerewolfSeats(ctx, tx, id); err != nil {
		return game, err
	}
	game.Messages, err = readGhostMessages(ctx, tx, id)
	return game, err
}

func readWerewolfRoles(ctx context.Context, tx *sql.Tx, id int64) ([]programme.WerewolfRole, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,role_key,name,description,quantity FROM programme_werewolf_roles
 WHERE activity_id=$1 ORDER BY position LIMIT $2`, id, programme.WerewolfRoleLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []programme.WerewolfRole
	for rows.Next() {
		var role programme.WerewolfRole
		if err := rows.Scan(&role.ID, &role.Key, &role.Name, &role.Description, &role.Count); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func readWerewolfSeats(ctx context.Context, tx *sql.Tx, id int64) ([]programme.WerewolfSeat, error) {
	rows, err := tx.QueryContext(ctx, `SELECT p.guest_id,g.name,CASE WHEN g.avatar_jpeg IS NOT NULL THEN g.avatar_version ELSE 0 END,
 p.alive,p.mayor,COALESCE(p.role_id,0)
 FROM programme_werewolf_players p JOIN guests g ON g.id=p.guest_id
 WHERE p.activity_id=$1 ORDER BY p.id LIMIT $2`, id, programme.WerewolfPlayerLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var seats []programme.WerewolfSeat
	for rows.Next() {
		var seat programme.WerewolfSeat
		var guestID, avatar int64
		var name string
		if err := rows.Scan(&guestID, &name, &avatar, &seat.Alive, &seat.Mayor, &seat.RoleID); err != nil {
			return nil, err
		}
		seat.Person = person(guestID, name, avatar)
		seats = append(seats, seat)
	}
	return seats, rows.Err()
}

// readGhostMessages lists the messages in the join order of their authors,
// which says nothing about when they were written.
func readGhostMessages(ctx context.Context, tx *sql.Tx, id int64) ([]programme.GhostMessage, error) {
	rows, err := tx.QueryContext(ctx, `SELECT m.guest_id,m.body,m.delivered FROM programme_werewolf_messages m
 JOIN programme_werewolf_players p ON p.activity_id=m.activity_id AND p.guest_id=m.guest_id
 WHERE m.activity_id=$1 ORDER BY p.id LIMIT $2`, id, programme.WerewolfPlayerLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var messages []programme.GhostMessage
	for rows.Next() {
		var message programme.GhostMessage
		if err := rows.Scan(&message.AuthorID, &message.Text, &message.Delivered); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (s *Store) ReadWerewolf(ctx context.Context, actor programme.Actor, eventID int64) (programme.Werewolf, error) {
	tx, _, game, err := s.werewolfTransaction(ctx, actor, eventID, false)
	if err != nil {
		return programme.Werewolf{}, err
	}
	defer tx.Rollback()
	return game.View(actor.GuestID), s.commit(tx)
}

// changeWerewolf runs one change on the locked game and returns the game as
// the actor sees it afterwards. change receives the state read under the
// lock and decides with the core rules before it writes.
func (s *Store) changeWerewolf(ctx context.Context, actor programme.Actor, eventID int64, change func(tx *sql.Tx, id int64, game programme.WerewolfGame) error) (programme.Werewolf, error) {
	tx, id, game, err := s.werewolfTransaction(ctx, actor, eventID, true)
	if err != nil {
		return programme.Werewolf{}, err
	}
	defer tx.Rollback()
	if err := change(tx.Tx, id, game); err != nil {
		return programme.Werewolf{}, err
	}
	if game, err = readWerewolfGame(ctx, tx.Tx, id); err != nil {
		return programme.Werewolf{}, err
	}
	return game.View(actor.GuestID), s.commit(tx)
}

// commandWerewolf is changeWerewolf for a command of the game master, which
// also advances the revision. Players joining, leaving and writing leave it.
func (s *Store) commandWerewolf(ctx context.Context, actor programme.Actor, eventID int64, command func(tx *sql.Tx, id int64, game programme.WerewolfGame) error) (programme.Werewolf, error) {
	return s.changeWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := command(tx, id, game); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "UPDATE programme_activities SET revision=revision+1 WHERE id=$1", id)
		return err
	})
}

func (s *Store) JoinWerewolf(ctx context.Context, actor programme.Actor, eventID int64) (programme.Werewolf, error) {
	return s.changeWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckJoin(actor.GuestID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO programme_werewolf_players(activity_id,guest_id) VALUES($1,$2)
 ON CONFLICT(activity_id,guest_id) DO NOTHING`, id, actor.GuestID)
		return err
	})
}

func (s *Store) LeaveWerewolf(ctx context.Context, actor programme.Actor, eventID int64) (programme.Werewolf, error) {
	return s.changeWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckLeave(); err != nil {
			return err
		}
		return removeWerewolfPlayer(ctx, tx, id, actor.GuestID)
	})
}

func removeWerewolfPlayer(ctx context.Context, tx *sql.Tx, id, guestID int64) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM programme_werewolf_players WHERE activity_id=$1 AND guest_id=$2", id, guestID)
	return err
}

func (s *Store) RemoveWerewolfPlayer(ctx context.Context, actor programme.Actor, eventID, guestID int64) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckRemoval(actor.GuestID); err != nil {
			return err
		}
		return removeWerewolfPlayer(ctx, tx, id, guestID)
	})
}

func (s *Store) SaveWerewolfRoles(ctx context.Context, actor programme.Actor, eventID, revision int64, roles []programme.WerewolfRoleInput) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckRoles(actor.GuestID, revision, roles); err != nil {
			return err
		}
		return saveWerewolfRoles(ctx, tx, id, roles)
	})
}

// saveWerewolfRoles makes the saved list match the given one, in its order:
// roles sent with an ID keep it, the others are added and the rest removed.
// Only a game in the lobby is edited, so no player holds a removed role.
func saveWerewolfRoles(ctx context.Context, tx *sql.Tx, id int64, roles []programme.WerewolfRoleInput) error {
	ids, quantities := make([]int64, len(roles)), make([]int64, len(roles))
	keys, names, descriptions := make([]*string, len(roles)), make([]*string, len(roles)), make([]*string, len(roles))
	for i, role := range roles {
		ids[i], keys[i], names[i], descriptions[i], quantities[i] = role.ID, role.Key, role.Name, role.Description, int64(role.Count)
	}
	const given = ` unnest($2::bigint[],$3::text[],$4::text[],$5::text[],$6::bigint[])
 WITH ORDINALITY AS given(id,role_key,name,description,quantity,position)`
	if _, err := tx.ExecContext(ctx, "DELETE FROM programme_werewolf_roles WHERE activity_id=$1 AND id<>ALL($2::bigint[])", id, ids); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE programme_werewolf_roles r
 SET name=given.name,description=given.description,quantity=given.quantity,position=given.position-1
 FROM`+given+` WHERE r.activity_id=$1 AND r.id=given.id`, id, ids, keys, names, descriptions, quantities)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO programme_werewolf_roles(activity_id,position,role_key,name,description,quantity)
 SELECT $1,given.position-1,given.role_key,given.name,given.description,given.quantity
 FROM`+given+` WHERE given.id=0 ORDER BY given.position`, id, ids, keys, names, descriptions, quantities)
	return err
}

// SetWerewolfVariants switches both variants. Without ghost messages there
// are no nights and nothing left to deliver.
func (s *Store) SetWerewolfVariants(ctx context.Context, actor programme.Actor, eventID int64, hideRolesOfDead, ghostMessages bool) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckGameMaster(actor.GuestID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE programme_werewolf_games SET hide_roles_of_dead=$2,ghost_messages=$3,
 phase=CASE WHEN $3 THEN phase ELSE 'day' END WHERE activity_id=$1`, id, hideRolesOfDead, ghostMessages)
		if err != nil || ghostMessages {
			return err
		}
		return clearGhostMessages(ctx, tx, id)
	})
}

func clearGhostMessages(ctx context.Context, tx *sql.Tx, id int64) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM programme_werewolf_messages WHERE activity_id=$1", id)
	return err
}

func (s *Store) TransitionWerewolf(ctx context.Context, actor programme.Actor, eventID int64, action programme.WerewolfAction, revision int64) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckAction(actor.GuestID, action, revision); err != nil {
			return err
		}
		switch action {
		case programme.WerewolfStart:
			if err := dealWerewolfRoles(ctx, tx, id, game); err != nil {
				return err
			}
			return setWerewolfStatus(ctx, tx, id, programme.WerewolfRunning)
		case programme.WerewolfFinish:
			return setWerewolfStatus(ctx, tx, id, programme.WerewolfFinished)
		case programme.WerewolfReset:
			return resetWerewolf(ctx, tx, id)
		}
		return programme.ErrActivityConflict
	})
}

func setWerewolfStatus(ctx context.Context, tx *sql.Tx, id int64, status programme.WerewolfStatus) error {
	_, err := tx.ExecContext(ctx, "UPDATE programme_werewolf_games SET status=$2 WHERE activity_id=$1", id, string(status))
	return err
}

// dealWerewolfRoles deals inside the transaction that starts the game, from
// the players and quantities read under the game lock.
func dealWerewolfRoles(ctx context.Context, tx *sql.Tx, id int64, game programme.WerewolfGame) error {
	playerIDs := make([]int64, len(game.Players))
	for i, seat := range game.Players {
		playerIDs[i] = seat.ID
	}
	dealt, err := programme.DealWerewolfRoles(playerIDs, game.Roles, newRandom())
	if err != nil {
		return err
	}
	roleIDs := make([]int64, len(playerIDs))
	for i, playerID := range playerIDs {
		roleIDs[i] = dealt[playerID]
	}
	_, err = tx.ExecContext(ctx, `UPDATE programme_werewolf_players p SET role_id=dealt.role_id
 FROM unnest($2::bigint[],$3::bigint[]) AS dealt(guest_id,role_id)
 WHERE p.activity_id=$1 AND p.guest_id=dealt.guest_id`, id, playerIDs, roleIDs)
	return err
}

// resetWerewolf returns to the lobby with the same players, roles and variants.
func resetWerewolf(ctx context.Context, tx *sql.Tx, id int64) error {
	_, err := tx.ExecContext(ctx, "UPDATE programme_werewolf_players SET role_id=NULL,alive=TRUE,mayor=FALSE WHERE activity_id=$1", id)
	if err != nil {
		return err
	}
	if err := clearGhostMessages(ctx, tx, id); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "UPDATE programme_werewolf_games SET status=$2,phase=$3 WHERE activity_id=$1",
		id, string(programme.WerewolfLobby), string(programme.PhaseDay))
	return err
}

// SetWerewolfLife marks a player dead or alive again. A mayor who dies stops
// being mayor. A player brought back was never a ghost: their message goes.
func (s *Store) SetWerewolfLife(ctx context.Context, actor programme.Actor, eventID, guestID int64, alive bool) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckLife(actor.GuestID, guestID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE programme_werewolf_players SET alive=$3,mayor=mayor AND $3
 WHERE activity_id=$1 AND guest_id=$2`, id, guestID, alive)
		if err != nil || !alive {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM programme_werewolf_messages WHERE activity_id=$1 AND guest_id=$2", id, guestID)
		return err
	})
}

func (s *Store) SetWerewolfMayor(ctx context.Context, actor programme.Actor, eventID int64, guestID *int64) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckMayor(actor.GuestID, guestID); err != nil {
			return err
		}
		// Two statements: the one-mayor index is checked row by row.
		_, err := tx.ExecContext(ctx, "UPDATE programme_werewolf_players SET mayor=FALSE WHERE activity_id=$1 AND mayor", id)
		if err != nil || guestID == nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE programme_werewolf_players SET mayor=TRUE WHERE activity_id=$1 AND guest_id=$2", id, *guestID)
		return err
	})
}

// SetWerewolfPhase switches between day and night. The night starts without
// messages; the day delivers one of the night's messages to the mayor, drawn
// inside this transaction from the messages read under the game lock.
func (s *Store) SetWerewolfPhase(ctx context.Context, actor programme.Actor, eventID int64, phase programme.WerewolfPhase) (programme.Werewolf, error) {
	return s.commandWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		changed, err := game.CheckPhase(actor.GuestID, phase)
		if err != nil || !changed {
			return err
		}
		if phase == programme.PhaseNight {
			err = clearGhostMessages(ctx, tx, id)
		} else if authorID, drawn := game.DrawMessage(newRandom()); drawn {
			_, err = tx.ExecContext(ctx, "UPDATE programme_werewolf_messages SET delivered=TRUE WHERE activity_id=$1 AND guest_id=$2", id, authorID)
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE programme_werewolf_games SET phase=$2 WHERE activity_id=$1", id, string(phase))
		return err
	})
}

func (s *Store) WriteWerewolfMessage(ctx context.Context, actor programme.Actor, eventID int64, text string) (programme.Werewolf, error) {
	return s.changeWerewolf(ctx, actor, eventID, func(tx *sql.Tx, id int64, game programme.WerewolfGame) error {
		if err := game.CheckMessage(actor.GuestID); err != nil {
			return err
		}
		var err error
		if text == "" {
			_, err = tx.ExecContext(ctx, "DELETE FROM programme_werewolf_messages WHERE activity_id=$1 AND guest_id=$2", id, actor.GuestID)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO programme_werewolf_messages(activity_id,guest_id,body) VALUES($1,$2,$3)
 ON CONFLICT(activity_id,guest_id) DO UPDATE SET body=excluded.body`, id, actor.GuestID, text)
		}
		return err
	})
}
