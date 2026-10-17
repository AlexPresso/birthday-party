package app

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

type MediaCategory struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	IsPublic bool   `json:"isPublic"`
}

func (a *App) listMediaCategories(w http.ResponseWriter, r *http.Request, guest Guest) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,name,is_public FROM media_categories WHERE is_public OR $1 ORDER BY id LIMIT 100", guest.Role == "admin")
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []MediaCategory{}
	for rows.Next() {
		var item MediaCategory
		if err := rows.Scan(&item.ID, &item.Name, &item.IsPublic); err != nil {
			internal(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"items": items})
}

func (a *App) saveMediaCategory(w http.ResponseWriter, r *http.Request, _ Guest) {
	var input struct {
		Name     string `json:"name"`
		IsPublic *bool  `json:"isPublic"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 80 || input.IsPublic == nil {
		fail(w, 400, "invalid_media_category")
		return
	}
	category := MediaCategory{Name: input.Name, IsPublic: *input.IsPublic}
	if r.Method == http.MethodPut {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		err := a.db.QueryRowContext(r.Context(), "UPDATE media_categories SET name=$1,is_public=$2 WHERE id=$3 RETURNING id", category.Name, category.IsPublic, id).Scan(&category.ID)
		if errors.Is(err, sql.ErrNoRows) {
			fail(w, 404, "media_category_not_found")
			return
		}
		if err != nil {
			internal(w, err)
			return
		}
		a.notifyCategoryUploads(r.Context(), category.ID)
		respond(w, 200, category)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73006)"); err != nil {
		internal(w, err)
		return
	}
	var count int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM media_categories").Scan(&count); err != nil {
		internal(w, err)
		return
	}
	if count >= 100 {
		fail(w, 409, "media_category_limit")
		return
	}
	if err = tx.QueryRowContext(r.Context(), "INSERT INTO media_categories(name,is_public) VALUES($1,$2) RETURNING id", category.Name, category.IsPublic).Scan(&category.ID); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	respond(w, 201, category)
}

func requestedCategory(r *http.Request) (*int64, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, &mediaValidationError{400, "invalid_media_category"}
	}
	values, exists := query["categoryId"]
	if !exists {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, &mediaValidationError{400, "invalid_media_category"}
	}
	id, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || id < 1 {
		return nil, &mediaValidationError{400, "invalid_media_category"}
	}
	return &id, nil
}

func sameOptionalID(a, b *int64) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
