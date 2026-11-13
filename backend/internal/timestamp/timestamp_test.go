package timestamp

import (
	"testing"
	"time"
)

func TestNormalizeAcceptsOffsetsAndRejectsInvalidInstants(t *testing.T) {
	if normalized, ok := Normalize(nil); normalized != nil || !ok {
		t.Fatal("an absent instant must stay absent")
	}
	for input, want := range map[string]string{
		"2026-10-30T19:00:00+01:00":           "2026-10-30T18:00:00Z",
		"2026-10-30T19:00:00.123+01:00":       "2026-10-30T18:00:00.123Z",
		"2026-10-30T18:00:00.123456789Z":      "2026-10-30T18:00:00.123456Z",
		"2000-01-01T00:00:00Z":                "2000-01-01T00:00:00Z",
		"2200-12-31T23:59:59Z":                "2200-12-31T23:59:59Z",
		"2026-10-30T18:00:00.000000000+00:00": "2026-10-30T18:00:00Z",
	} {
		original := input
		normalized, ok := Normalize(&input)
		if !ok || normalized == nil || *normalized != want {
			t.Errorf("Normalize(%q) = %v, %v; want %q", original, normalized, ok, want)
		}
		if input != original {
			t.Errorf("Normalize modified its input %q", original)
		}
	}
	for _, input := range []string{"", "invalid", "2026-10-30", "2026-10-30 18:00:00", "1999-12-31T23:59:59Z", "2201-01-01T00:00:00Z"} {
		if normalized, ok := Normalize(&input); ok || normalized != nil {
			t.Errorf("Normalize(%q) accepted an invalid instant", input)
		}
	}
}

func TestFormatUsesUTCAndRoundTrips(t *testing.T) {
	zurich := time.FixedZone("CEST", 2*60*60)
	instant := time.Date(2026, 10, 17, 20, 15, 0, 250_000_000, zurich)
	formatted := Format(instant)
	if formatted != "2026-10-17T18:15:00.25Z" {
		t.Fatalf("Format = %q", formatted)
	}
	parsed, err := Parse(formatted)
	if err != nil || !parsed.Equal(instant) {
		t.Fatalf("Parse(%q) = %v, %v", formatted, parsed, err)
	}
	if FormatOptional(nil) != nil || *FormatOptional(&instant) != formatted {
		t.Fatal("optional instants are not formatted consistently")
	}
}
