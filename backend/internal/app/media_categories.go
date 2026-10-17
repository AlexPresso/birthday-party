package app

import (
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"net/http"
	"net/url"
	"strconv"
)

func (a *App) listMediaCategories(w http.ResponseWriter, r *http.Request, guest identity.Guest) {
	items, err := a.media.Categories(r.Context(), guest.Role == "admin")
	if err != nil {
		failUpload(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) saveMediaCategory(w http.ResponseWriter, r *http.Request, _ identity.Guest) {
	var input struct {
		Name     string `json:"name"`
		IsPublic *bool  `json:"isPublic"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.IsPublic == nil {
		fail(w, 400, "invalid_media_category")
		return
	}
	category := media.Category{Name: input.Name, IsPublic: *input.IsPublic}
	status := http.StatusCreated
	if r.Method == http.MethodPut {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		category.ID = id
		status = http.StatusOK
	}
	saved, err := a.media.SaveCategory(r.Context(), category)
	if err != nil {
		failUpload(w, err)
		return
	}
	if category.ID != 0 {
		a.notifyCategoryUploads(r.Context(), saved.ID)
	}
	respond(w, status, saved)
}

func requestedCategory(r *http.Request) (*int64, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, &media.Error{Code: "invalid_media_category"}
	}
	values, exists := query["categoryId"]
	if !exists {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, &media.Error{Code: "invalid_media_category"}
	}
	id, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || id < 1 {
		return nil, &media.Error{Code: "invalid_media_category"}
	}
	return &id, nil
}
