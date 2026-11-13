package app

import (
	"errors"
	"log"
	"net/http"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/guestbook"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"birthday-party/backend/internal/notifications"
	"birthday-party/backend/internal/party"
	"birthday-party/backend/internal/profile"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/welcome"
)

const internalErrorCode = "internal_error"

// apiError is how one failure is presented to clients: the HTTP status it
// travels with and an English fallback for the stable code they translate.
type apiError struct {
	status  int
	message string
}

// apiErrors is the single place where an error code gets its HTTP status.
// Every code the API can return is listed here; docs/api.md describes them.
var apiErrors = map[string]apiError{
	// Requests and sessions.
	"invalid_body":        {http.StatusBadRequest, "We couldn’t read what you sent. Try again."},
	"invalid_id":          {http.StatusBadRequest, "We couldn’t find this item. Refresh the page."},
	"invalid_cursor":      {http.StatusBadRequest, "This page could not be loaded. Refresh the page."},
	"invalid_page_size":   {http.StatusBadRequest, "This page couldn’t load. Refresh it and try again."},
	"not_found":           {http.StatusNotFound, "This item could not be found."},
	"request_forbidden":   {http.StatusForbidden, "This action isn’t allowed."},
	"too_many_attempts":   {http.StatusTooManyRequests, "Too many attempts. Try again in a minute."},
	"invitation_required": {http.StatusUnauthorized, "Open your invitation to sign in."},
	"session_expired":     {http.StatusUnauthorized, "Your session has expired. Ask the host for a new invitation."},
	"access_revoked":      {http.StatusUnauthorized, "You no longer have access to the party. Contact the host."},
	"admin_required":      {http.StatusForbidden, "Only the host can access this area."},
	"welcome_required":    {http.StatusLocked, "Complete the welcome before accessing the app."},
	internalErrorCode:     {http.StatusInternalServerError, "Something went wrong. Try again in a moment."},

	// Invitations and guests.
	"invalid_invitation":     {http.StatusUnauthorized, "This link is invalid or has expired. Ask the host for a new invitation."},
	"invitation_unavailable": {http.StatusUnauthorized, "This link is invalid, expired or already used. Ask the host for a new invitation."},
	"invitation_used":        {http.StatusUnauthorized, "This invitation has already been used. Ask the host for a new one."},
	"invalid_guest_name":     {http.StatusBadRequest, "The name must contain between 1 and 80 characters."},
	"guest_limit_reached":    {http.StatusConflict, "You’ve reached the limit of 500 guests."},
	"self_revoke_forbidden":  {http.StatusConflict, "You cannot remove your own access."},

	// Party details and configuration.
	"invalid_party":         {http.StatusBadRequest, "The title can contain up to 120 characters and the location up to 240."},
	"invalid_timezone":      {http.StatusBadRequest, "Choose a time zone such as Europe/Zurich."},
	"unknown_timezone":      {http.StatusBadRequest, "This time zone was not found. Try Europe/Zurich."},
	"invalid_date":          {http.StatusBadRequest, "Choose the date and time again, then save."},
	"invalid_configuration": {http.StatusBadRequest, "Choose an age from 1 to 150 and upload limits from 1 to 1024 MiB. Invitation titles allow 200 characters and descriptions 2000."},

	// Welcome sequence.
	"welcome_conflict":           {http.StatusConflict, "The welcome sequence changed. Refresh it before trying again."},
	"invalid_welcome_steps":      {http.StatusBadRequest, "Add up to 12 steps with 1 to 12 widgets each. Titles can have 120 characters and texts 1,000."},
	"invalid_welcome_action":     {http.StatusBadRequest, "Choose an available widget and check its settings."},
	"invalid_welcome_transition": {http.StatusConflict, "This action isn't available now. Refresh the welcome sequence."},

	// Notifications.
	"invalid_notification_subscription": {http.StatusBadRequest, "Notifications couldn't be set up. Try again."},
	"notification_subscription_limit":   {http.StatusConflict, "You've reached the notification device limit. Turn notifications off on another device first."},

	// Programme, votes and questions.
	"invalid_event":          {http.StatusBadRequest, "Add a title (up to 160 characters). The description and hint are optional (up to 4000 and 160 characters)."},
	"event_limit_reached":    {http.StatusConflict, "You’ve reached the limit of 200 events."},
	"invalid_activity":       {http.StatusBadRequest, "Add a question of up to 240 characters and 2 to 200 different choices."},
	"activity_conflict":      {http.StatusConflict, "This activity changed or this action is no longer available. Refresh and try again."},
	"vote_closed":            {http.StatusConflict, "Voting is closed."},
	"invalid_vote_option":    {http.StatusBadRequest, "This choice is no longer available. Pick another one."},
	"self_vote_forbidden":    {http.StatusBadRequest, "You cannot vote for yourself in this activity."},
	"write_ins_disabled":     {http.StatusForbidden, "Adding a choice isn’t allowed for this vote."},
	"vote_option_limit":      {http.StatusConflict, "This vote already has the maximum number of choices."},
	"invalid_vote_label":     {http.StatusBadRequest, "Enter a choice of 1 to 80 characters."},
	"invalid_question":       {http.StatusBadRequest, "Write a question of 1 to 1000 characters."},
	"questions_closed":       {http.StatusConflict, "Questions and upvotes are closed."},
	"question_limit_reached": {http.StatusConflict, "This activity has reached its limit of 200 questions."},
	"no_jokers_left":         {http.StatusConflict, "Both jokers have already been used."},

	// Guestbook.
	"invalid_message":          {http.StatusBadRequest, "Your message must contain between 1 and 2000 characters."},
	"message_not_found":        {http.StatusNotFound, "This message could not be found."},
	"message_delete_forbidden": {http.StatusForbidden, "You can only delete your own messages."},

	// Media categories, gallery and uploads.
	"invalid_media_category":     {http.StatusBadRequest, "Choose a category with a name of 1 to 80 characters and a visibility setting."},
	"media_category_not_found":   {http.StatusNotFound, "This category is no longer available."},
	"media_category_limit":       {http.StatusConflict, "You can create up to 100 media categories."},
	"photo_not_found":            {http.StatusNotFound, "This file could not be found."},
	"photo_unavailable":          {http.StatusNotFound, "This file is no longer available."},
	"photo_delete_forbidden":     {http.StatusForbidden, "You can only delete your own photos and videos."},
	"album_full":                 {http.StatusConflict, "The gallery is full (5000 files or 10 GB). Contact the host."},
	"upload_queue_full":          {http.StatusConflict, "The upload queue is full. Wait for a few files to finish, then try again."},
	"upload_not_found":           {http.StatusNotFound, "This upload could not be found."},
	"invalid_upload_id":          {http.StatusBadRequest, "The upload could not be started. Choose the file again."},
	"photo_required":             {http.StatusBadRequest, "Choose a photo or video to upload."},
	"single_photo_required":      {http.StatusBadRequest, "Upload one file at a time."},
	"photo_upload_failed":        {http.StatusBadRequest, "The file didn’t upload. Try again."},
	"photo_too_large":            {http.StatusRequestEntityTooLarge, "This photo is too large. Choose a smaller file."},
	"photo_dimensions_too_large": {http.StatusRequestEntityTooLarge, "This photo exceeds 40 megapixels. Choose a smaller image."},
	"unsupported_photo_type":     {http.StatusUnsupportedMediaType, "Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video."},
	"unreadable_photo":           {http.StatusUnsupportedMediaType, "This photo could not be read. Choose another image."},
	"video_too_large":            {http.StatusRequestEntityTooLarge, "This video is too large. Choose a smaller file."},
	"video_too_long":             {http.StatusRequestEntityTooLarge, "Videos can be up to 5 minutes long. Choose a shorter video."},
	"video_dimensions_too_large": {http.StatusRequestEntityTooLarge, "This video exceeds 4K resolution. Choose a smaller video."},
	"unreadable_video":           {http.StatusUnsupportedMediaType, "This video could not be read. Choose another video."},
	"video_processing_failed":    {http.StatusUnprocessableEntity, "This video could not be prepared. Try another file."},

	// Profile photos.
	"profile_photo_required":         {http.StatusBadRequest, "Choose a profile photo."},
	"unsupported_profile_photo_type": {http.StatusUnsupportedMediaType, "Choose a JPEG, PNG or WebP photo."},
	"profile_photo_busy":             {http.StatusTooManyRequests, "Another profile photo is being saved. Try again in a moment."},
	"profile_photo_not_found":        {http.StatusNotFound, "This profile photo is no longer available."},
}

// sentinelCodes names the API code of feature errors that do not carry one.
var sentinelCodes = []struct {
	err  error
	code string
}{
	{identity.ErrInvalidName, "invalid_guest_name"},
	{identity.ErrInvalidInvitation, "invalid_invitation"},
	{identity.ErrUnavailableInvitation, "invitation_unavailable"},
	{identity.ErrUsedInvitation, "invitation_used"},
	{identity.ErrLimitReached, "guest_limit_reached"},
	{identity.ErrNotFound, "not_found"},
	{identity.ErrSelfRevoke, "self_revoke_forbidden"},
	{guestbook.ErrInvalidMessage, "invalid_message"},
	{guestbook.ErrNotFound, "message_not_found"},
	{guestbook.ErrDeleteForbidden, "message_delete_forbidden"},
	{programme.ErrInvalidEvent, "invalid_event"},
	{programme.ErrInvalidDate, "invalid_date"},
	{programme.ErrLimitReached, "event_limit_reached"},
	{programme.ErrNotFound, "not_found"},
	{media.ErrNotFound, "upload_not_found"},
}

// errorCode returns the stable API code of a feature rejection. It reports
// false for any other error, which must stay private.
func errorCode(err error) (string, bool) {
	var (
		denied       access.Error
		sequence     welcome.Error
		details      party.Error
		photo        profile.Error
		activity     programme.ActivityError
		upload       *media.Error
		subscription *notifications.Error
	)
	switch {
	case errors.As(err, &denied):
		return string(denied), true
	case errors.As(err, &sequence):
		return string(sequence), true
	case errors.As(err, &details):
		return string(details), true
	case errors.As(err, &photo):
		return string(photo), true
	case errors.As(err, &activity):
		return string(activity), true
	case errors.As(err, &upload):
		return upload.Code, true
	case errors.As(err, &subscription):
		return subscription.Code, true
	}
	for _, sentinel := range sentinelCodes {
		if errors.Is(err, sentinel.err) {
			return sentinel.code, true
		}
	}
	return "", false
}

// fail writes the API error for code. A code missing from apiErrors is a
// programming error: the client receives the generic internal error instead.
func fail(w http.ResponseWriter, code string) {
	failure, known := apiErrors[code]
	if !known {
		log.Printf("request failed with unregistered error code %q", code)
		code, failure = internalErrorCode, apiErrors[internalErrorCode]
	}
	respond(w, failure.status, map[string]string{"code": code, "error": failure.message})
}

// failError answers a failed operation. A feature rejection becomes its API
// error; anything else is logged and reported as an internal error without
// details.
func failError(w http.ResponseWriter, err error) {
	code, rejected := errorCode(err)
	if !rejected {
		log.Printf("request failed: %v", err)
		code = internalErrorCode
	}
	fail(w, code)
}
