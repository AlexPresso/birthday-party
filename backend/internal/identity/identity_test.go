package identity

import (
	"errors"
	"strings"
	"testing"
)

func TestTokensAreIndependentAndMalformedCredentialsAreRejected(t *testing.T) {
	first, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || !ValidToken(first) || !ValidToken(second) {
		t.Fatal("generated tokens must be independent valid credentials")
	}
	if HashToken(first) == first || len(HashToken(first)) != 64 || HashToken(first) == HashToken(second) {
		t.Fatal("stored credential digests must not contain the raw token")
	}
	for _, token := range []string{"", first[:42], first + "=", strings.Repeat("*", 43), " " + first[1:]} {
		if ValidToken(token) {
			t.Fatal("malformed credential was accepted")
		}
	}
}

func TestNamesUseCharacterLimitsAndTrimWhitespace(t *testing.T) {
	for _, test := range []struct {
		name, want string
		valid      bool
	}{
		{"  Camille  ", "Camille", true},
		{strings.Repeat("é", 80), strings.Repeat("é", 80), true},
		{strings.Repeat("é", 81), "", false},
		{" \n\t ", "", false},
	} {
		name, err := normalizeName(test.name)
		if test.valid {
			if err != nil || name != test.want {
				t.Fatalf("name=%q want=%q error=%v", name, test.want, err)
			}
		} else if !errors.Is(err, ErrInvalidName) {
			t.Fatalf("error=%v want invalid name", err)
		}
	}
}
