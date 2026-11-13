package app

import (
	"math"
	"net/http"
	"net/url"
	"strconv"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/media"
)

// A welcome step holds at most 12 widgets, so indexes run from 0 to 11.
const maxWelcomeWidgetIndex = 11

func (a *App) getWelcomeUploadContext(w http.ResponseWriter, r *http.Request, viewer access.Viewer) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	values := query["widgetIndex"]
	if err != nil || len(values) != 1 {
		fail(w, "invalid_body")
		return
	}
	index, err := strconv.Atoi(values[0])
	if err != nil || index < 0 || index > maxWelcomeWidgetIndex {
		fail(w, "invalid_body")
		return
	}
	result, err := a.media.UploadContext(r.Context(), viewer.Guest.ID, index)
	if err != nil {
		failError(w, err)
		return
	}
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	respond(w, http.StatusOK, map[string]any{"revision": result.Revision, "widgetIndex": result.WidgetIndex, "category": result.Category, "limits": limits})
}

// parseUploadDestination reads the requested category and, for a welcome
// widget upload, the progress revision and widget index sent together.
func parseUploadDestination(r *http.Request, viewer access.Viewer) (media.Destination, error) {
	destination := media.Destination{SessionHash: viewer.SessionHash}
	var err error
	if destination.CategoryID, err = requestedCategory(r); err != nil {
		return destination, err
	}
	if destination.WelcomeRevision, err = optionalHeaderNumber(r, "X-Welcome-Revision", math.MaxInt64); err != nil {
		return destination, err
	}
	if destination.WelcomeWidgetIndex, err = optionalHeaderNumber(r, "X-Welcome-Widget-Index", maxWelcomeWidgetIndex); err != nil {
		return destination, err
	}
	if (destination.WelcomeRevision == nil) != (destination.WelcomeWidgetIndex == nil) {
		return destination, &media.Error{Code: "invalid_body"}
	}
	return destination, nil
}

// optionalHeaderNumber reads an integer header from 0 to limit, sent at most once.
func optionalHeaderNumber(r *http.Request, name string, limit int64) (*int64, error) {
	values, exists := r.Header[name]
	if !exists {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, &media.Error{Code: "invalid_body"}
	}
	value, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || value < 0 || value > limit {
		return nil, &media.Error{Code: "invalid_body"}
	}
	return &value, nil
}
