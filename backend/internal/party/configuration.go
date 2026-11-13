package party

import (
	"context"
	"strings"
	"unicode/utf8"

	"birthday-party/backend/internal/locale"
)

const ErrInvalidConfiguration Error = "invalid_configuration"

type InvitationText struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
}

type InvitationCopy struct {
	InvitationText
	Locales map[string]InvitationText `json:"locales"`
}

// PublicConfiguration contains only content displayed before invitation activation.
type PublicConfiguration struct {
	Age        int            `json:"age"`
	Invitation InvitationCopy `json:"invitation"`
}

type Configuration struct {
	PublicConfiguration
	ImageSizeMB int `json:"imageSizeMB"`
	VideoSizeMB int `json:"videoSizeMB"`
}

type ConfigurationActor struct {
	GuestID     int64
	SessionHash string
}

type ConfigurationRepository interface {
	Configuration(context.Context) (Configuration, error)
	SaveConfiguration(context.Context, ConfigurationActor, Configuration) error
}

type ConfigurationService struct{ repository ConfigurationRepository }

func NewConfiguration(repository ConfigurationRepository) *ConfigurationService {
	return &ConfigurationService{repository: repository}
}

func (s *ConfigurationService) Get(ctx context.Context) (Configuration, error) {
	return s.repository.Configuration(ctx)
}

func (s *ConfigurationService) Update(ctx context.Context, actor ConfigurationActor, input Configuration) (Configuration, error) {
	normalized, err := NormalizeConfiguration(input)
	if err != nil {
		return Configuration{}, err
	}
	return normalized, s.repository.SaveConfiguration(ctx, actor, normalized)
}

func DefaultConfiguration() Configuration {
	locales := make(map[string]InvitationText, len(locale.Supported()))
	for _, tag := range locale.Supported() {
		locales[tag] = InvitationText{}
	}
	return Configuration{
		PublicConfiguration: PublicConfiguration{Age: 30, Invitation: InvitationCopy{Locales: locales}},
		ImageSizeMB:         15,
		VideoSizeMB:         100,
	}
}

func NormalizeConfiguration(input Configuration) (Configuration, error) {
	return normalizeConfiguration(input, true)
}

// NormalizeInitialConfiguration preserves legacy copy that predates editor limits.
func NormalizeInitialConfiguration(input Configuration) (Configuration, error) {
	return normalizeConfiguration(input, false)
}

func normalizeConfiguration(input Configuration, restrictText bool) (Configuration, error) {
	if input.Age < 1 || input.Age > 150 || input.ImageSizeMB < 1 || input.ImageSizeMB > 1024 || input.VideoSizeMB < 1 || input.VideoSizeMB > 1024 {
		return input, ErrInvalidConfiguration
	}
	text, err := normalizeInvitationText(input.Invitation.InvitationText, restrictText)
	if err != nil {
		return input, err
	}
	input.Invitation.InvitationText = text
	supported := locale.Supported()
	if len(input.Invitation.Locales) != len(supported) {
		return input, ErrInvalidConfiguration
	}
	locales := make(map[string]InvitationText, len(supported))
	for _, tag := range supported {
		text, exists := input.Invitation.Locales[tag]
		if !exists {
			return input, ErrInvalidConfiguration
		}
		normalized, err := normalizeInvitationText(text, restrictText)
		if err != nil {
			return input, err
		}
		locales[tag] = normalized
	}
	input.Invitation.Locales = locales
	return input, nil
}

func normalizeInvitationText(input InvitationText, restrictText bool) (InvitationText, error) {
	trim := func(value *string, limit int) (*string, error) {
		if value == nil {
			return nil, nil
		}
		text := strings.TrimSpace(*value)
		if restrictText && utf8.RuneCountInString(text) > limit {
			return nil, ErrInvalidConfiguration
		}
		return &text, nil
	}
	title, err := trim(input.Title, 200)
	if err != nil {
		return input, err
	}
	description, err := trim(input.Description, 2000)
	return InvitationText{Title: title, Description: description}, err
}
