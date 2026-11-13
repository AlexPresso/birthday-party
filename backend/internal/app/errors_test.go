package app

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/media"
	"birthday-party/backend/internal/notifications"
	"birthday-party/backend/internal/party"
	"birthday-party/backend/internal/profile"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/welcome"
)

func TestEveryFeatureErrorHasOneAPIEntry(t *testing.T) {
	rejections := []error{
		access.ErrInvitation, access.ErrExpired, access.ErrAdmin, access.ErrWelcome,
		welcome.ErrInvalidSteps, welcome.ErrInvalidAction, welcome.ErrConflict, welcome.ErrTransition, welcome.ErrCategoryNotFound,
		party.ErrInvalidParty, party.ErrInvalidTimezone, party.ErrUnknownTimezone, party.ErrInvalidDate, party.ErrInvalidConfiguration,
		profile.ErrRevoked, profile.ErrExpired, profile.ErrWelcome, profile.ErrNotFound,
		programme.ErrInvalidActivity, programme.ErrActivityConflict, programme.ErrVoteClosed, programme.ErrInvalidCandidate, programme.ErrSelfVote,
		programme.ErrInvalidQuestion, programme.ErrQuestionsClosed, programme.ErrQuestionLimit, programme.ErrNoJokers,
	}
	for _, sentinel := range sentinelCodes {
		rejections = append(rejections, sentinel.err)
	}
	for _, rejection := range rejections {
		// Feature errors reach handlers wrapped with context.
		code, known := errorCode(fmt.Errorf("save: %w", rejection))
		if _, registered := apiErrors[code]; !known || !registered {
			t.Errorf("%v has no API entry (code %q)", rejection, code)
		}
	}
	for code, entry := range apiErrors {
		if entry.status < 400 || entry.status > 599 || entry.message == "" {
			t.Errorf("%s has status %d and message %q", code, entry.status, entry.message)
		}
	}
}

func TestErrorWriterKeepsStatusesAndHidesInternalCauses(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{access.ErrWelcome, http.StatusLocked, "welcome_required"},
		{access.ErrAdmin, http.StatusForbidden, "admin_required"},
		{profile.ErrExpired, http.StatusUnauthorized, "session_expired"},
		{welcome.ErrTransition, http.StatusConflict, "invalid_welcome_transition"},
		{programme.ErrNotFound, http.StatusNotFound, "not_found"},
		{programme.ErrNoJokers, http.StatusConflict, "no_jokers_left"},
		{media.ErrNotFound, http.StatusNotFound, "upload_not_found"},
		{&media.Error{Code: "video_processing_failed"}, http.StatusUnprocessableEntity, "video_processing_failed"},
		{&media.Error{Code: "photo_too_large"}, http.StatusRequestEntityTooLarge, "photo_too_large"},
		{&notifications.Error{Code: "notification_subscription_limit"}, http.StatusConflict, "notification_subscription_limit"},
		{&media.Error{Code: "unregistered_code"}, http.StatusInternalServerError, "internal_error"},
		{errors.New("pq: password authentication failed for user birthday"), http.StatusInternalServerError, "internal_error"},
	} {
		w := httptest.NewRecorder()
		failError(w, test.err)
		want := fmt.Sprintf(`{"code":%q,"error":%q}`+"\n", test.code, apiErrors[test.code].message)
		if w.Code != test.status || w.Body.String() != want {
			t.Errorf("%v: status=%d body=%s, want %d %s", test.err, w.Code, w.Body.String(), test.status, want)
		}
	}
}
