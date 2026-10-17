package webpush

import "testing"

func TestNotificationSubjectDefaultsAndValidation(t *testing.T) {
	for _, test := range []struct{ value, origin, want string }{
		{"", "https://party.example.invalid", "https://party.example.invalid"},
		{"", "http://localhost:3000", "mailto:notifications@example.invalid"},
		{"", "https://localhost", "mailto:notifications@example.invalid"},
		{"", "https://127.0.0.1", "mailto:notifications@example.invalid"},
		{"mailto:host@example.invalid", "http://localhost:3000", "mailto:host@example.invalid"},
		{"https://party.example.invalid/contact", "http://localhost:3000", "https://party.example.invalid/contact"},
	} {
		got, err := Subject(test.value, test.origin)
		if err != nil || got != test.want {
			t.Fatalf("subject=%q want=%q err=%v", got, test.want, err)
		}
	}
	for _, value := range []string{"http://party.example.invalid", "mailto:invalid", "host@example.invalid", "https://user@party.example.invalid", "https://party.example.invalid/#fragment"} {
		if _, err := Subject(value, "http://localhost:3000"); err == nil {
			t.Fatal("invalid VAPID subject was accepted")
		}
	}
}
