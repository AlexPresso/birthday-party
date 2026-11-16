// Package party owns party details and validation.
package party

import (
	"context"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"birthday-party/backend/internal/timestamp"
)

type Party struct {
	Title    string  `json:"title"`
	Timezone string  `json:"timezone"`
	Date     *string `json:"date"`
	Location string  `json:"location"`
	// MapURL is an https link to a map of the location, or empty.
	MapURL string `json:"mapUrl"`
}

type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrInvalidParty    Error = "invalid_party"
	ErrInvalidTimezone Error = "invalid_timezone"
	ErrUnknownTimezone Error = "unknown_timezone"
	ErrInvalidDate     Error = "invalid_date"
	ErrInvalidMapLink  Error = "invalid_map_link"
)

type Repository interface {
	Get(context.Context) (Party, error)
	Save(context.Context, Party) error
}
type Service struct{ repository Repository }

func New(repository Repository) *Service { return &Service{repository: repository} }

func (s *Service) Get(ctx context.Context) (Party, error) { return s.repository.Get(ctx) }

func (s *Service) Update(ctx context.Context, input Party) (Party, error) {
	normalized, err := Normalize(input)
	if err != nil {
		return Party{}, err
	}
	return normalized, s.repository.Save(ctx, normalized)
}

func Normalize(input Party) (Party, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Location = strings.TrimSpace(input.Location)
	if utf8.RuneCountInString(input.Title) > 120 || utf8.RuneCountInString(input.Location) > 240 {
		return input, ErrInvalidParty
	}
	input.MapURL = strings.TrimSpace(input.MapURL)
	if input.MapURL != "" && !validMapLink(input.MapURL) {
		return input, ErrInvalidMapLink
	}
	if input.Timezone == "" || input.Timezone == "Local" || len(input.Timezone) > 80 {
		return input, ErrInvalidTimezone
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		return input, ErrUnknownTimezone
	}
	date, ok := timestamp.Normalize(input.Date)
	if !ok {
		return input, ErrInvalidDate
	}
	input.Date = date
	return input, nil
}

// validMapLink accepts any https address of at most 500 characters: guests
// open it in their own map app, whatever service the host chose.
func validMapLink(link string) bool {
	parsed, err := url.Parse(link)
	return err == nil && len(link) <= 500 && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}
