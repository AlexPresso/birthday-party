package programme

import (
	"context"
	"time"
)

// AnnouncementKind names the moment of the programme a notification announces.
type AnnouncementKind string

const (
	AnnounceStart  AnnouncementKind = "programme_start"
	AnnounceUnlock AnnouncementKind = "programme_unlock"
)

// AnnouncementGrace bounds how late a missed moment is still announced, for
// example after the server was down.
const AnnouncementGrace = 15 * time.Minute

// Announcement is one moment to tell guests about. Title is what the
// programme shows guests at that moment: it is empty for an event that is
// still locked and has no teaser.
type Announcement struct {
	EventID int64
	Kind    AnnouncementKind
	Title   string
}

// Scheduled is the part of an event that decides its announcements.
type Scheduled struct {
	ID       int64
	Title    string
	Teaser   string
	StartsAt *time.Time
	UnlockAt *time.Time
	// Draft marks a vote or question activity that guests cannot see yet.
	Draft bool
}

// Announcements returns what became due after the previous pass and up to
// now, in the order of the events given. An event whose start and unlock are
// both due is announced once, as a start. Moments older than the grace period
// and events hidden from guests are skipped.
func Announcements(events []Scheduled, after, now time.Time) []Announcement {
	oldest := now.Add(-AnnouncementGrace)
	due := func(moment *time.Time) bool {
		return moment != nil && moment.After(after) && !moment.After(now) && !moment.Before(oldest)
	}
	var announcements []Announcement
	for _, event := range events {
		if event.Draft {
			continue
		}
		switch {
		case due(event.StartsAt):
			title := event.Title
			if event.UnlockAt != nil && event.UnlockAt.After(now) {
				title = event.Teaser
			}
			announcements = append(announcements, Announcement{EventID: event.ID, Kind: AnnounceStart, Title: title})
		case due(event.UnlockAt):
			announcements = append(announcements, Announcement{EventID: event.ID, Kind: AnnounceUnlock, Title: event.Title})
		}
	}
	return announcements
}

// NextMoment returns the next start or unlock after now, or the zero time.
func (s *Service) NextMoment(ctx context.Context, now time.Time) (time.Time, error) {
	return s.repository.NextMoment(ctx, now)
}

// Announce queues notifications for the moments reached since the last call
// and reports how many announcements it queued. Each moment is announced once.
func (s *Service) Announce(ctx context.Context, now time.Time) (int, error) {
	return s.repository.Announce(ctx, now)
}

// Notifications reports whether the host lets the programme notify guests.
func (s *Service) Notifications(ctx context.Context) (bool, error) {
	return s.repository.NotificationsEnabled(ctx)
}

func (s *Service) SetNotifications(ctx context.Context, enabled bool) error {
	return s.repository.SetNotificationsEnabled(ctx, enabled)
}
