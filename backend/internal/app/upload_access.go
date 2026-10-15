package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
)

// A welcome upload keeps its destination and revision across reception and retries.
// Receiving a large file never holds a transaction or a database row lock.
type uploadDestination struct {
	categoryID      *int64
	welcomeRevision *int64
	sessionHash     string
}

func (a *App) getWelcomeUploadContext(w http.ResponseWriter, r *http.Request, _ Guest) {
	var revision int64
	var categoryID *int64
	var name *string
	var public *bool
	err := a.db.QueryRowContext(r.Context(), `SELECT w.revision,c.id,c.name,c.is_public
 FROM welcome w LEFT JOIN media_categories c ON c.id=(w.steps->(w.current_step-1)->'mediaUpload'->>'categoryId')::bigint
 WHERE w.id=1 AND NOT w.is_open AND w.current_step>0 AND w.steps->(w.current_step-1)->>'action'='media_upload'`).Scan(&revision, &categoryID, &name, &public)
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
	respond(w, 200, map[string]any{"revision": revision, "category": category, "limits": map[string]int64{"imageBytes": a.config.MaxImageBytes, "videoBytes": a.config.MaxVideoBytes}})
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
	var open bool
	var revision int64
	var action *string
	var categoryID *int64
	// Lock order: quota (when accepting), guest, session, welcome, category.
	err = tx.QueryRowContext(ctx, `SELECT is_open,revision,
 CASE WHEN current_step>0 THEN steps->(current_step-1)->>'action' END,
 CASE WHEN current_step>0 THEN (steps->(current_step-1)->'mediaUpload'->>'categoryId')::bigint END
 FROM welcome WHERE id=1 FOR SHARE`).Scan(&open, &revision, &action, &categoryID)
	if err != nil {
		return err
	}
	if destination.welcomeRevision != nil {
		if open || action == nil || *action != "media_upload" || revision != *destination.welcomeRevision {
			return &mediaValidationError{409, "welcome_conflict"}
		}
		if destination.categoryID != nil && !sameOptionalID(destination.categoryID, categoryID) {
			return &mediaValidationError{400, "invalid_media_category"}
		}
		destination.categoryID = categoryID
	} else if role != "admin" && !open {
		if action != nil && *action == "media_upload" {
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
	if !sameOptionalID(job.WelcomeRevision, destination.welcomeRevision) {
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
