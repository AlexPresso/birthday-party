// Package guestbook owns messages, anonymous attribution and deletion permissions.
package guestbook

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/timestamp"
)

const (
	maxPageSize     = 48
	maxMessageRunes = 2000
	// MaxVoiceDuration is five minutes, plus the moment a recorder may add
	// while stopping.
	MaxVoiceDuration = 302 * time.Second
	// VoicePeaks is the number of waveform levels kept for each voice note.
	VoicePeaks = 48
)

var (
	ErrInvalidMessage  = errors.New("message must contain 1–2000 characters")
	ErrNotFound        = errors.New("message not found")
	ErrDeleteForbidden = errors.New("message deletion is not permitted")
	ErrInvalidVoice    = errors.New("voice note must be a readable recording of at most five minutes")
)

// Voice is a voice note as the server encoded it: the audio file, its length
// and the waveform levels (0–255) the interface draws.
type Voice struct {
	Audio    []byte
	Duration time.Duration
	Peaks    []byte
}

// VoiceSummary describes a stored voice note without its audio.
type VoiceSummary struct {
	Duration time.Duration
	Peaks    []byte
}

// VoiceView is what viewers receive; the audio is read from URL.
type VoiceView struct {
	URL        string `json:"url"`
	DurationMS int64  `json:"durationMs"`
	Peaks      []int  `json:"peaks"`
}

// Entry omits its owner entirely when anonymous, including for administrators.
type Entry struct {
	ID        int64            `json:"id"`
	Author    *identity.Author `json:"author"`
	Anonymous bool             `json:"anonymous"`
	CanDelete bool             `json:"canDelete"`
	Body      string           `json:"body"`
	Voice     *VoiceView       `json:"voice"`
	CreatedAt string           `json:"createdAt"`
}

// Record is private persistence data. Only Entry may be returned to a viewer.
type Record struct {
	ID        int64
	Author    identity.Author
	Anonymous bool
	Body      string
	Voice     *VoiceSummary
	CreatedAt time.Time
}

// Repository persists entries and retains their owners for permission checks.
type Repository interface {
	List(ctx context.Context, beforeID int64, limit int) ([]Record, error)
	// Create stores the entry and, when audio is not nil, its voice note.
	Create(ctx context.Context, record Record, audio []byte) (int64, error)
	// VoiceAudio returns ErrNotFound when the entry has no voice note.
	VoiceAudio(ctx context.Context, entryID int64) ([]byte, error)
	Owner(ctx context.Context, entryID int64) (int64, error)
	Delete(ctx context.Context, entryID int64) (bool, error)
}

// Service enforces message validation, anonymous attribution and deletion rules.
type Service struct{ repository Repository }

// New returns a service backed by repository.
func New(repository Repository) *Service { return &Service{repository: repository} }

// List returns a bounded page plus one entry for cursor pagination.
func (s *Service) List(ctx context.Context, viewer identity.Guest, beforeID int64, limit int) ([]Entry, error) {
	pageSize := min(max(limit, 1), maxPageSize)
	fetchLimit := pageSize + 1
	records, err := s.repository.List(ctx, beforeID, fetchLimit)
	if err != nil {
		return nil, err
	}
	items := make([]Entry, 0, len(records))
	for _, record := range records {
		items = append(items, record.view(viewer))
	}
	return items, nil
}

func (record Record) view(viewer identity.Guest) Entry {
	entry := Entry{
		ID:        record.ID,
		Anonymous: record.Anonymous,
		CanDelete: viewer.IsAdmin() || viewer.ID == record.Author.ID,
		Body:      record.Body,
		CreatedAt: timestamp.Format(record.CreatedAt),
	}
	if !record.Anonymous {
		entry.Author = &record.Author
	}
	if record.Voice != nil {
		peaks := make([]int, len(record.Voice.Peaks))
		for index, level := range record.Voice.Peaks {
			peaks[index] = int(level)
		}
		entry.Voice = &VoiceView{
			URL:        "/api/guestbook/" + strconv.FormatInt(record.ID, 10) + "/voice",
			DurationMS: record.Voice.Duration.Milliseconds(),
			Peaks:      peaks,
		}
	}
	return entry
}

// Create stores the owner for permissions without exposing anonymous attribution.
func (s *Service) Create(ctx context.Context, viewer identity.Guest, body string, anonymous bool, now time.Time) (Entry, error) {
	body = strings.TrimSpace(body)
	if length := utf8.RuneCountInString(body); length < 1 || length > maxMessageRunes {
		return Entry{}, ErrInvalidMessage
	}
	return s.create(ctx, viewer, body, anonymous, nil, now)
}

// CreateVoice stores a voice note with an optional message. A voice note is
// always signed: the voice would give the author away anyway.
func (s *Service) CreateVoice(ctx context.Context, viewer identity.Guest, body string, voice Voice, now time.Time) (Entry, error) {
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(body) > maxMessageRunes {
		return Entry{}, ErrInvalidMessage
	}
	if len(voice.Audio) == 0 || voice.Duration <= 0 || voice.Duration > MaxVoiceDuration || len(voice.Peaks) != VoicePeaks {
		return Entry{}, ErrInvalidVoice
	}
	return s.create(ctx, viewer, body, false, &voice, now)
}

func (s *Service) create(ctx context.Context, viewer identity.Guest, body string, anonymous bool, voice *Voice, now time.Time) (Entry, error) {
	record := Record{
		Author: identity.Author{
			ID:        viewer.ID,
			Name:      viewer.Name,
			AvatarURL: viewer.AvatarURL,
		},
		Anonymous: anonymous,
		Body:      body,
		CreatedAt: now,
	}
	var audio []byte
	if voice != nil {
		record.Voice = &VoiceSummary{Duration: voice.Duration, Peaks: voice.Peaks}
		audio = voice.Audio
	}
	var err error
	record.ID, err = s.repository.Create(ctx, record, audio)
	if err != nil {
		return Entry{}, err
	}
	return record.view(viewer), nil
}

// VoiceAudio returns an entry's recording to a viewer who may read the guestbook.
func (s *Service) VoiceAudio(ctx context.Context, entryID int64) ([]byte, error) {
	return s.repository.VoiceAudio(ctx, entryID)
}

// Delete permits only the author or an administrator, regardless of anonymity.
// It returns false when another request deleted the entry after the permission check.
func (s *Service) Delete(ctx context.Context, entryID int64, viewer identity.Guest) (bool, error) {
	ownerID, err := s.repository.Owner(ctx, entryID)
	if err != nil {
		return false, err
	}
	if !viewer.IsAdmin() && viewer.ID != ownerID {
		return false, ErrDeleteForbidden
	}
	return s.repository.Delete(ctx, entryID)
}
