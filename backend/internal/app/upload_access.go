package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

// A welcome upload keeps its destination and revision across reception and retries.
// Receiving a large file never holds a transaction or a database row lock.
type uploadDestination struct {
	categoryID         *int64
	welcomeRevision    *int64
	welcomeWidgetIndex *int64
	sessionHash        string
}

func (a *App) getWelcomeUploadContext(w http.ResponseWriter, r *http.Request, guest Guest) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	values := query["widgetIndex"]
	if err != nil || len(values) != 1 {
		fail(w, 400, "invalid_body")
		return
	}
	index, err := strconv.Atoi(values[0])
	if err != nil || index < 0 || index > 11 {
		fail(w, 400, "invalid_body")
		return
	}
	var revision int64
	var categoryID *int64
	var name *string
	var public *bool
	err = a.db.QueryRowContext(r.Context(), `SELECT p.revision,c.id,c.name,c.is_public
 FROM welcome w JOIN guest_welcome_progress p ON p.guest_id=$2
 LEFT JOIN media_categories c ON c.id=(w.steps->(p.position-1)->'widgets'->$1::integer->'mediaUpload'->>'categoryId')::bigint
 WHERE w.id=1 AND `+welcomePositionSQL+`
 AND w.steps->(p.position-1)->'widgets'->$1::integer->>'type'='media_upload'`, index, guest.ID).Scan(&revision, &categoryID, &name, &public)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, http.StatusLocked, "welcome_required")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	var category *MediaCategory
	if categoryID != nil {
		category = &MediaCategory{ID: *categoryID, Name: *name, IsPublic: *public}
	}
	respond(w, 200, map[string]any{"revision": revision, "widgetIndex": index, "category": category, "limits": map[string]int64{"imageBytes": a.config.MaxImageBytes, "videoBytes": a.config.MaxVideoBytes}})
}

func parseUploadDestination(r *http.Request) (uploadDestination, error) {
	var destination uploadDestination
	var err error
	destination.categoryID, err = requestedCategory(r)
	if err != nil {
		return destination, err
	}
	if values, exists := r.Header["X-Welcome-Revision"]; exists {
		if len(values) != 1 {
			return destination, &mediaValidationError{400, "invalid_body"}
		}
		revision, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || revision < 0 {
			return destination, &mediaValidationError{400, "invalid_body"}
		}
		destination.welcomeRevision = &revision
	}
	if values, exists := r.Header["X-Welcome-Widget-Index"]; exists {
		if len(values) != 1 {
			return destination, &mediaValidationError{400, "invalid_body"}
		}
		index, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || index < 0 || index > 11 {
			return destination, &mediaValidationError{400, "invalid_body"}
		}
		destination.welcomeWidgetIndex = &index
	}
	if (destination.welcomeRevision == nil) != (destination.welcomeWidgetIndex == nil) {
		return destination, &mediaValidationError{400, "invalid_body"}
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return destination, &mediaValidationError{401, "session_expired"}
	}
	destination.sessionHash = hashToken(cookie.Value)
	return destination, nil
}

func (a *App) authorizeUpload(ctx context.Context, tx *sql.Tx, guestID int64, destination *uploadDestination) error {
	var active bool
	var role string
	if err := tx.QueryRowContext(ctx, "SELECT active,role FROM guests WHERE id=$1 FOR UPDATE", guestID).Scan(&active, &role); err != nil {
		return err
	}
	if !active {
		return &mediaValidationError{401, "access_revoked"}
	}
	var expires int64
	err := tx.QueryRowContext(ctx, "SELECT expires_at FROM sessions WHERE token_hash=$1 AND guest_id=$2 FOR SHARE", destination.sessionHash, guestID).Scan(&expires)
	if errors.Is(err, sql.ErrNoRows) || err == nil && expires <= a.now().Unix() {
		return &mediaValidationError{401, "session_expired"}
	}
	if err != nil {
		return err
	}
	// Lock order: quota (when accepting), guest, session, welcome, progress, category.
	view, err := currentGuestWelcome(ctx, tx, guestID)
	if err != nil {
		return err
	}
	var selected *welcomeWidget
	var mediaWidget bool
	if view.Step != nil {
		for i := range view.Step.Widgets {
			widget := &view.Step.Widgets[i]
			mediaWidget = mediaWidget || widget.Type == "media_upload"
			if destination.welcomeWidgetIndex != nil && int64(i) == *destination.welcomeWidgetIndex {
				selected = widget
			}
		}
	}
	if destination.welcomeRevision != nil {
		if view.Open || selected == nil || selected.Type != "media_upload" || view.ProgressRevision != *destination.welcomeRevision {
			return &mediaValidationError{409, "welcome_conflict"}
		}
		categoryID := selected.MediaUpload.CategoryID
		if destination.categoryID != nil && !sameOptionalID(destination.categoryID, categoryID) {
			return &mediaValidationError{400, "invalid_media_category"}
		}
		destination.categoryID = categoryID
	} else if role != "admin" && !view.Open {
		if mediaWidget {
			return &mediaValidationError{400, "invalid_body"}
		}
		return &mediaValidationError{http.StatusLocked, "welcome_required"}
	}
	if destination.categoryID != nil {
		var public bool
		err := tx.QueryRowContext(ctx, "SELECT is_public FROM media_categories WHERE id=$1 FOR SHARE", *destination.categoryID).Scan(&public)
		if errors.Is(err, sql.ErrNoRows) {
			return &mediaValidationError{404, "media_category_not_found"}
		}
		if err != nil {
			return err
		}
		if !public && role != "admin" && destination.welcomeRevision == nil {
			return &mediaValidationError{404, "media_category_not_found"}
		}
	}
	return nil
}

func sameUploadDestination(job UploadJob, destination uploadDestination) error {
	if !sameOptionalID(job.WelcomeRevision, destination.welcomeRevision) || !sameOptionalID(job.WelcomeWidgetIndex, destination.welcomeWidgetIndex) {
		return &mediaValidationError{409, "welcome_conflict"}
	}
	if !sameOptionalID(job.CategoryID, destination.categoryID) {
		return &mediaValidationError{400, "invalid_media_category"}
	}
	return nil
}

func (a *App) inspectUpload(ctx context.Context, guestID int64, clientID string, destination *uploadDestination) (*UploadJob, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := a.authorizeUpload(ctx, tx, guestID, destination); err != nil {
		return nil, err
	}
	job, err := scanUpload(tx.QueryRowContext(ctx, uploadSelect+` WHERE j.guest_id=$1 AND j.client_upload_id=$2`, guestID, clientID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := sameUploadDestination(job, *destination); err != nil {
		return nil, err
	}
	return &job, nil
}
