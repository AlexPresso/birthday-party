// Package guestbook implements guestbook persistence in PostgreSQL.
package guestbook

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"birthday-party/backend/internal/guestbook"
	"birthday-party/backend/internal/identity"
)

// Store uses the application's database pool; its caller owns pool lifetime.
type Store struct{ db *sql.DB }

var _ guestbook.Repository = (*Store)(nil)

// New uses the application's initialized database.
func New(db *sql.DB) *Store { return &Store{db: db} }

// List returns a bounded page of private records for service-side attribution.
func (s *Store) List(ctx context.Context, beforeID int64, limit int) ([]guestbook.Record, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			e.id,
			COALESCE(g.id,0),
			COALESCE(g.name,''),
			e.anonymous,
			e.body,
			e.created_at,
			CASE
				WHEN NOT e.anonymous AND g.avatar_jpeg IS NOT NULL THEN g.avatar_version
				ELSE 0
			END,
			v.duration_ms,
			v.peaks
		FROM entries e
		LEFT JOIN guests g ON e.guest_id=g.id
		LEFT JOIN guestbook_voice_notes v ON v.entry_id=e.id
		WHERE ($1::bigint=0 OR e.id<$2)
		ORDER BY e.id DESC
		LIMIT $3`, beforeID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []guestbook.Record{}
	for rows.Next() {
		var record guestbook.Record
		var avatarVersion int64
		var voiceMS sql.NullInt64
		var peaks []byte
		if err := rows.Scan(
			&record.ID,
			&record.Author.ID,
			&record.Author.Name,
			&record.Anonymous,
			&record.Body,
			&record.CreatedAt,
			&avatarVersion,
			&voiceMS,
			&peaks,
		); err != nil {
			return nil, err
		}
		if voiceMS.Valid {
			record.Voice = &guestbook.VoiceSummary{Duration: time.Duration(voiceMS.Int64) * time.Millisecond, Peaks: peaks}
		}
		record.Author.AvatarURL = identity.AvatarURL(record.Author.ID, avatarVersion)
		items = append(items, record)
	}
	return items, rows.Err()
}

// Create retains the owner even when the entry is anonymous, and stores the
// entry with its voice note in one transaction.
func (s *Store) Create(ctx context.Context, record guestbook.Record, audio []byte) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO entries(guest_id,anonymous,body,created_at)
		VALUES($1,$2,$3,$4)
		RETURNING id`, record.Author.ID, record.Anonymous, record.Body, record.CreatedAt).Scan(&id)
	if err != nil {
		return 0, err
	}
	if record.Voice != nil {
		if _, err := tx.ExecContext(ctx, "INSERT INTO guestbook_voice_notes(entry_id,duration_ms,peaks,audio) VALUES($1,$2,$3,$4)",
			id, record.Voice.Duration.Milliseconds(), record.Voice.Peaks, audio); err != nil {
			return 0, err
		}
	}
	return id, tx.Commit()
}

// VoiceAudio reads the recording of one entry.
func (s *Store) VoiceAudio(ctx context.Context, entryID int64) ([]byte, error) {
	var audio []byte
	err := s.db.QueryRowContext(ctx, "SELECT audio FROM guestbook_voice_notes WHERE entry_id=$1", entryID).Scan(&audio)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, guestbook.ErrNotFound
	}
	return audio, err
}

// Owner returns the owner used by the service's deletion policy: zero once
// the guest was deleted.
func (s *Store) Owner(ctx context.Context, entryID int64) (int64, error) {
	var ownerID int64
	err := s.db.QueryRowContext(ctx, "SELECT COALESCE(guest_id,0) FROM entries WHERE id=$1", entryID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, guestbook.ErrNotFound
	}
	return ownerID, err
}

// Delete reports whether this call removed an entry.
func (s *Store) Delete(ctx context.Context, entryID int64) (bool, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM entries WHERE id=$1", entryID)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count != 0, err
}
