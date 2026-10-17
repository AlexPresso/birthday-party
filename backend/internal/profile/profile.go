// Package profile owns profile photo operations and access rules.
package profile

import (
	"context"
	"errors"
	"io"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

const MaxAvatarBytes = 128 << 10

type Error string

func (e Error) Error() string { return string(e) }

const (
	ErrRevoked  Error = "access_revoked"
	ErrExpired  Error = "session_expired"
	ErrWelcome  Error = "welcome_required"
	ErrNotFound Error = "profile_photo_not_found"
)

// Repository rechecks identity, session and welcome access in the save transaction.
type Repository interface {
	Save(context.Context, int64, string, []byte) (identity.Guest, error)
	Avatar(context.Context, int64, int64) ([]byte, error)
}
type Processor interface {
	Prepare(context.Context, io.ReadSeeker) ([]byte, error)
}
type Service struct {
	repository Repository
	processor  Processor
}

func New(repository Repository, processor Processor) *Service {
	return &Service{repository: repository, processor: processor}
}

func (s *Service) Prepare(ctx context.Context, input io.ReadSeeker) ([]byte, error) {
	return s.processor.Prepare(ctx, input)
}

func (s *Service) Save(ctx context.Context, id int64, session string, data []byte) (identity.Guest, error) {
	if len(data) > MaxAvatarBytes {
		return identity.Guest{}, errors.New("normalized avatar exceeded its storage limit")
	}
	return s.repository.Save(ctx, id, session, data)
}

func (s *Service) Avatar(ctx context.Context, id, version int64) ([]byte, error) {
	if id <= 0 || version <= 0 {
		return nil, ErrNotFound
	}
	return s.repository.Avatar(ctx, id, version)
}

func CanEdit(guest identity.Guest, view welcome.View) error {
	if !guest.Active {
		return ErrRevoked
	}
	allowed := guest.Role == "admin" || view.Open
	if view.Step != nil {
		for _, widget := range view.Step.Widgets {
			allowed = allowed || widget.Type == "profile_photo"
		}
	}
	if !allowed {
		return ErrWelcome
	}
	return nil
}
