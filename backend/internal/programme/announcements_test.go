package programme

import (
	"reflect"
	"testing"
	"time"
)

func TestAnnouncementsFollowWhatGuestsSee(t *testing.T) {
	now := time.Date(2026, 11, 14, 20, 0, 0, 0, time.UTC)
	after := now.Add(-time.Minute)
	at := func(offset time.Duration) *time.Time {
		moment := now.Add(offset)
		return &moment
	}
	events := []Scheduled{
		{ID: 1, Title: "Cake", StartsAt: at(0)},
		{ID: 2, Title: "Fireworks", Teaser: "Meet outside", StartsAt: at(0), UnlockAt: at(time.Hour)},
		{ID: 3, Title: "Secret", StartsAt: at(-30 * time.Second), UnlockAt: at(time.Hour)},
		{ID: 4, Title: "Revealed late", StartsAt: at(-time.Hour), UnlockAt: at(0)},
		{ID: 5, Title: "Revealed at its start", StartsAt: at(0), UnlockAt: at(0)},
		{ID: 6, Title: "Revealed ahead", StartsAt: at(time.Hour), UnlockAt: at(-10 * time.Second)},
		{ID: 7, Title: "Draft vote", StartsAt: at(0), Draft: true},
		{ID: 8, Title: "Already announced", StartsAt: &after},
		{ID: 9, Title: "Later", StartsAt: at(time.Second), UnlockAt: at(time.Minute)},
		{ID: 10, Title: "No time"},
	}
	want := []Announcement{
		{EventID: 1, Kind: AnnounceStart, Title: "Cake"},
		{EventID: 2, Kind: AnnounceStart, Title: "Meet outside"},
		{EventID: 3, Kind: AnnounceStart, Title: ""},
		{EventID: 4, Kind: AnnounceUnlock, Title: "Revealed late"},
		{EventID: 5, Kind: AnnounceStart, Title: "Revealed at its start"},
		{EventID: 6, Kind: AnnounceUnlock, Title: "Revealed ahead"},
	}
	if got := Announcements(events, after, now); !reflect.DeepEqual(got, want) {
		t.Fatalf("announcements=%+v", got)
	}
}

func TestAnnouncementsDropMomentsOlderThanTheGracePeriod(t *testing.T) {
	now := time.Date(2026, 11, 14, 20, 0, 0, 0, time.UTC)
	long := now.Add(-24 * time.Hour)
	recent, stale := now.Add(-AnnouncementGrace), now.Add(-AnnouncementGrace-time.Second)
	events := []Scheduled{{ID: 1, Title: "Just in time", StartsAt: &recent}, {ID: 2, Title: "Too old", StartsAt: &stale}}
	want := []Announcement{{EventID: 1, Kind: AnnounceStart, Title: "Just in time"}}
	if got := Announcements(events, long, now); !reflect.DeepEqual(got, want) {
		t.Fatalf("announcements=%+v", got)
	}
}
