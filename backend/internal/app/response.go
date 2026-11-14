package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
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
	return pathValueID(w, r, "id")
}

// pathValueID reads the positive identifier in the named path segment.
func pathValueID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
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

// compressors reuses gzip writers: each one holds about 800 KB of state, and
// allocating it per response cost a fifth of the programme's throughput under
// load. The fastest level still shrinks the programme about tenfold.
var compressors = sync.Pool{New: func() any {
	compressor, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
	return compressor
}}

// respondCompressed gzips a large JSON document for clients that accept it.
// Use it for documents every open screen refetches after an invalidation,
// such as the programme.
func respondCompressed(w http.ResponseWriter, r *http.Request, status int, value any) {
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(value); err != nil {
		failError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Add("Vary", "Accept-Encoding")
	if body.Len() < 1<<10 || !acceptsGzip(r) {
		w.WriteHeader(status)
		_, _ = w.Write(body.Bytes())
		return
	}
	w.Header().Set("Content-Encoding", "gzip")
	w.WriteHeader(status)
	compressor := compressors.Get().(*gzip.Writer)
	compressor.Reset(w)
	_, _ = compressor.Write(body.Bytes())
	_ = compressor.Close()
	compressor.Reset(io.Discard)
	compressors.Put(compressor)
}

func acceptsGzip(r *http.Request) bool {
	for _, coding := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, parameters, _ := strings.Cut(coding, ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		quality, weighted := strings.CutPrefix(strings.TrimSpace(parameters), "q=")
		if !weighted {
			return true
		}
		value, err := strconv.ParseFloat(quality, 64)
		return err == nil && value > 0
	}
	return false
}
