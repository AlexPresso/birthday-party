package party

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type memoryRepository struct {
	details Party
	saved   bool
}

func (r *memoryRepository) Get(context.Context) (Party, error) { return r.details, nil }

func (r *memoryRepository) Save(_ context.Context, details Party) error {
	r.details = details
	r.saved = true
	return nil
}

func TestUpdateValidatesAndNormalizesBeforeSaving(t *testing.T) {
	repository := &memoryRepository{}
	service := New(repository)
	if _, err := service.Update(t.Context(), Party{Timezone: "Local"}); !errors.Is(err, ErrInvalidTimezone) || repository.saved {
		t.Fatalf("invalid timezone persisted: saved=%v error=%v", repository.saved, err)
	}
	date := "2026-10-30T19:00:00.123+01:00"
	result, err := service.Update(t.Context(), Party{Title: "  Birthday  ", Timezone: "Europe/Zurich", Date: &date, Location: "  Here  "})
	if err != nil {
		t.Fatal(err)
	}
	if !repository.saved || result.Title != "Birthday" || result.Location != "Here" || result.Date == nil || *result.Date != "2026-10-30T18:00:00.123Z" {
		t.Fatalf("unexpected update: %+v", result)
	}
	if date != "2026-10-30T19:00:00.123+01:00" {
		t.Fatal("normalization modified the caller date")
	}
}

func TestMapLinksAreHTTPSAddresses(t *testing.T) {
	for link, valid := range map[string]bool{
		"":                                    true,
		"  https://maps.app.goo.gl/abc123  ":  true,
		"https://www.google.com/maps/place/x": true,
		"http://maps.google.com/?q=1":         false,
		"javascript:alert(1)":                 false,
		"https://user:secret@maps.example":    false,
		"https://":                            false,
		"https://maps.example/" + strings.Repeat("a", 500): false,
	} {
		result, err := Normalize(Party{Timezone: "Europe/Zurich", MapURL: link})
		if valid != (err == nil) || (!valid && !errors.Is(err, ErrInvalidMapLink)) {
			t.Fatalf("%q: error = %v", link, err)
		}
		if valid && result.MapURL != strings.TrimSpace(link) {
			t.Fatalf("%q was saved as %q", link, result.MapURL)
		}
	}
}
