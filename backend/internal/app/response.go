package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
)

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	return decodeLimit(w, r, value, 64<<10)
}

func decodeLimit(w http.ResponseWriter, r *http.Request, value any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		fail(w, "invalid_body")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, "invalid_body")
		return false
	}
	return true
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		fail(w, "invalid_id")
		return 0, false
	}
	return id, true
}

func page(w http.ResponseWriter, r *http.Request) (int64, int, bool) {
	before := int64(0)
	limit := 24
	var err error
	if value := r.URL.Query().Get("before"); value != "" {
		before, err = strconv.ParseInt(value, 10, 64)
		if err != nil || before < 1 {
			fail(w, "invalid_cursor")
			return 0, 0, false
		}
	}
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 48 {
			fail(w, "invalid_page_size")
			return 0, 0, false
		}
	}
	return before, limit, true
}

func cursor(id int64) *string { result := strconv.FormatInt(id, 10); return &result }
