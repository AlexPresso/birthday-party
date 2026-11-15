package programme

import (
	"context"
	"database/sql"
	"time"

	"birthday-party/backend/internal/programme"
)

// NextMoment returns the earliest start or unlock after the given instant, or
// the zero time.
func (s *Store) NextMoment(ctx context.Context, after time.Time) (time.Time, error) {
	var next sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT MIN(moment) FROM (
 SELECT starts_at AS moment FROM events WHERE starts_at>$1
 UNION ALL SELECT unlock_at FROM events WHERE unlock_at>$1) moments`, after).Scan(&next)
	return next.Time, err
}

// Announce advances the announcement cursor to now and queues what became due
// since its previous position, in one transaction. The cursor's row lock
// serializes callers, so a moment is never announced twice, and the cursor
// advances even while the host has notifications turned off: turning them on
// later announces nothing from the past.
func (s *Store) Announce(ctx context.Context, now time.Time) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var enabled bool
	var through time.Time
	err = tx.QueryRowContext(ctx, "SELECT enabled,announced_through FROM programme_notifications WHERE id=1 FOR UPDATE").Scan(&enabled, &through)
	if err != nil || !now.After(through) {
		return 0, err
	}
	var due []programme.Announcement
	if enabled {
		// A long pause leaves old moments behind: read the grace period only.
		from := through
		if oldest := now.Add(-programme.AnnouncementGrace); oldest.After(from) {
			from = oldest
		}
		events, err := scheduledBetween(ctx, tx, from, now)
		if err != nil {
			return 0, err
		}
		due = programme.Announcements(events, through, now)
		if len(due) > 0 {
			if err = s.announce(ctx, tx, due); err != nil {
				return 0, err
			}
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE programme_notifications SET announced_through=$1 WHERE id=1", now); err != nil {
		return 0, err
	}
	return len(due), tx.Commit()
}

// scheduledBetween reads the events with a start or an unlock in (after, now],
// earliest first.
func scheduledBetween(ctx context.Context, tx *sql.Tx, after, now time.Time) ([]programme.Scheduled, error) {
	rows, err := tx.QueryContext(ctx, `SELECT e.id,e.title,e.teaser,e.starts_at,e.unlock_at,
 COALESCE(v.status='draft',FALSE)
 FROM events e
 LEFT JOIN programme_activities a ON a.event_id=e.id
 LEFT JOIN programme_votes v ON v.activity_id=a.id
 WHERE (e.starts_at>$1 AND e.starts_at<=$2) OR (e.unlock_at>$1 AND e.unlock_at<=$2)
 ORDER BY LEAST(e.starts_at,e.unlock_at),e.id`, after, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []programme.Scheduled
	for rows.Next() {
		var event programme.Scheduled
		var startsAt, unlockAt sql.NullTime
		if err = rows.Scan(&event.ID, &event.Title, &event.Teaser, &startsAt, &unlockAt, &event.Draft); err != nil {
			return nil, err
		}
		if startsAt.Valid {
			event.StartsAt = &startsAt.Time
		}
		if unlockAt.Valid {
			event.UnlockAt = &unlockAt.Time
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) NotificationsEnabled(ctx context.Context) (bool, error) {
	var enabled bool
	err := s.db.QueryRowContext(ctx, "SELECT enabled FROM programme_notifications WHERE id=1").Scan(&enabled)
	return enabled, err
}

func (s *Store) SetNotificationsEnabled(ctx context.Context, enabled bool) error {
	_, err := s.db.ExecContext(ctx, "UPDATE programme_notifications SET enabled=$1 WHERE id=1", enabled)
	return err
}
