// Package timestamp defines how the API represents instants: RFC 3339 strings
// in UTC, at the microsecond precision PostgreSQL stores.
package timestamp

import "time"

const (
	minYear = 2000
	maxYear = 2200
)

// Format renders an instant for an API response. Truncating to the stored
// precision keeps a value identical before and after it is saved.
func Format(t time.Time) string {
	return t.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
}

// FormatOptional renders a nullable instant; nil stays nil.
func FormatOptional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := Format(*t)
	return &formatted
}

// Parse reads an instant written by Format.
func Parse(value string) (time.Time, error) { return time.Parse(time.RFC3339Nano, value) }

// Normalize validates an optional instant supplied by a client and returns it
// in the API form without modifying the input. It reports false for a
// malformed value or a year outside 2000–2200.
func Normalize(value *string) (*string, bool) {
	if value == nil {
		return nil, true
	}
	parsed, err := time.Parse(time.RFC3339, *value)
	if err != nil || parsed.Year() < minYear || parsed.Year() > maxYear {
		return nil, false
	}
	normalized := Format(parsed)
	return &normalized, true
}
