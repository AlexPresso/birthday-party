package app

import (
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"net/http"
	"net/url"
	"strconv"
)

func (a *App) getWelcomeUploadContext(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
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
	result, err := a.media.UploadContext(r.Context(), guest.ID, index)
	if err != nil {
		failUpload(w, err)
		return
	}
	limits, ok := a.currentUploadLimits(w, r)
	if !ok {
		return
	}
	respond(w, 200, map[string]any{"revision": result.Revision, "widgetIndex": result.WidgetIndex, "category": result.Category, "limits": limits})
}

func parseUploadDestination(r *http.Request) (media.Destination, error) {
	var destination media.Destination
	var err error
	destination.CategoryID, err = requestedCategory(r)
	if err != nil {
		return destination, err
	}
	if values, exists := r.Header["X-Welcome-Revision"]; exists {
		if len(values) != 1 {
			return destination, &media.Error{Code: "invalid_body"}
		}
		revision, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || revision < 0 {
			return destination, &media.Error{Code: "invalid_body"}
		}
		destination.WelcomeRevision = &revision
	}
	if values, exists := r.Header["X-Welcome-Widget-Index"]; exists {
		if len(values) != 1 {
			return destination, &media.Error{Code: "invalid_body"}
		}
		index, err := strconv.ParseInt(values[0], 10, 64)
		if err != nil || index < 0 || index > 11 {
			return destination, &media.Error{Code: "invalid_body"}
		}
		destination.WelcomeWidgetIndex = &index
	}
	if (destination.WelcomeRevision == nil) != (destination.WelcomeWidgetIndex == nil) {
		return destination, &media.Error{Code: "invalid_body"}
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return destination, &media.Error{Code: "session_expired"}
	}
	destination.SessionHash = identity.HashToken(cookie.Value)
	return destination, nil
}
