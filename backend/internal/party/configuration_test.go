package party

import (
	"errors"
	"strings"
	"testing"
)

func TestConfigurationPreservesMissingAndHiddenCopy(t *testing.T) {
	input := DefaultConfiguration()
	title, empty, description := "  A birthday  ", "   ", "  See you there.  "
	input.Invitation.Title = &title
	input.Invitation.Locales["fr"] = InvitationText{Title: &empty, Description: &description}
	result, err := NormalizeConfiguration(input)
	if err != nil {
		t.Fatal(err)
	}
	if *result.Invitation.Title != "A birthday" || result.Invitation.Description != nil || *result.Invitation.Locales["fr"].Title != "" || *result.Invitation.Locales["fr"].Description != "See you there." {
		t.Fatalf("copy normalization lost fallback or hiding semantics: %+v", result.Invitation)
	}
	if *input.Invitation.Title != title || *input.Invitation.Locales["fr"].Title != empty {
		t.Fatal("normalization changed the caller's copy")
	}
}

func TestConfigurationValidation(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*Configuration)
	}{
		{"age below minimum", func(c *Configuration) { c.Age = 0 }},
		{"age above maximum", func(c *Configuration) { c.Age = 151 }},
		{"image below minimum", func(c *Configuration) { c.ImageSizeMB = 0 }},
		{"video above maximum", func(c *Configuration) { c.VideoSizeMB = 1025 }},
		{"long title", func(c *Configuration) { value := strings.Repeat("é", 201); c.Invitation.Title = &value }},
		{"long description", func(c *Configuration) {
			value := strings.Repeat("a", 2001)
			c.Invitation.Locales["de"] = InvitationText{Description: &value}
		}},
		{"missing locale", func(c *Configuration) { delete(c.Invitation.Locales, "en") }},
		{"unsupported locale", func(c *Configuration) {
			delete(c.Invitation.Locales, "en")
			c.Invitation.Locales["nl"] = InvitationText{}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := DefaultConfiguration()
			test.edit(&input)
			if _, err := NormalizeConfiguration(input); !errors.Is(err, ErrInvalidConfiguration) {
				t.Fatalf("invalid configuration accepted: %v", err)
			}
		})
	}
	input := DefaultConfiguration()
	input.Age, input.ImageSizeMB, input.VideoSizeMB = 150, 1024, 1
	value := strings.Repeat("é", 200)
	input.Invitation.Title = &value
	if _, err := NormalizeConfiguration(input); err != nil {
		t.Fatalf("valid boundaries rejected: %v", err)
	}
}
