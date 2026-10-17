package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func createTestCategory(t *testing.T, a *App, host *http.Cookie, name string, public bool) MediaCategory {
	t.Helper()
	response := request(t, a, "POST", "/api/admin/media-categories", map[string]any{"name": name, "isPublic": public}, host)
	status(t, response, 201)
	var category MediaCategory
	if err := json.Unmarshal(response.Body.Bytes(), &category); err != nil {
		t.Fatal(err)
	}
	return category
}

func TestMediaCategoryQueryRejectsMalformedDestinations(t *testing.T) {
	for _, query := range []string{"categoryId=%zz", "categoryId=1;categoryId=2", "categoryId=", "categoryId=0", "categoryId=-1", "categoryId=1&categoryId=2"} {
		t.Run(query, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/photos", nil)
			r.URL.RawQuery = query
			if _, err := requestedCategory(r); err == nil {
				t.Fatal("malformed category silently selected the main gallery")
			}
		})
	}
}

func mediaUploadRequest(t *testing.T, cookie *http.Cookie, categoryID, revision *int64, clientID string) *http.Request {
	t.Helper()
	r := avatarRequest(t, cookie, pngBytes(t))
	r.Method = http.MethodPost
	r.URL.Path = "/api/photos"
	if categoryID != nil {
		r.URL.RawQuery = "categoryId=" + strconv.FormatInt(*categoryID, 10)
	}
	if revision != nil {
		r.Header.Set("X-Welcome-Revision", strconv.FormatInt(*revision, 10))
		r.Header.Set("X-Welcome-Widget-Index", "1")
	}
	r.Header.Set("X-Upload-ID", clientID)
	return r
}

func performMediaUpload(a *App, r *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	a.Handler().ServeHTTP(response, r)
	return response
}

func finishCategoryUpload(t *testing.T, a *App, response *httptest.ResponseRecorder) Photo {
	t.Helper()
	status(t, response, 202)
	accepted := parseJob(t, response)
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if job.id != accepted.ID {
		t.Fatal("unexpected queued job")
	}
	a.processUpload(t.Context(), job)
	var photo Photo
	if err := a.db.QueryRow("SELECT p.id,p.category_id,p.mime FROM photos p JOIN upload_jobs j ON j.photo_id=p.id WHERE j.id=$1", job.id).Scan(&photo.ID, &photo.CategoryID, &photo.MIMEType); err != nil {
		t.Fatal(err)
	}
	photo.SetURLs()
	return photo
}

func TestMediaCategoriesValidateAndEnforceHostPermissions(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Category guest")
	status(t, request(t, a, "GET", "/api/media-categories", nil, nil), 401)
	status(t, request(t, a, "POST", "/api/admin/media-categories", map[string]any{"name": "Private", "isPublic": false}, visitor), 403)
	for _, input := range []any{
		map[string]any{"name": "", "isPublic": false},
		map[string]any{"name": strings.Repeat("é", 81), "isPublic": false},
		map[string]any{"name": "A category"},
		map[string]any{"name": "A category", "isPublic": nil},
	} {
		assertWelcomeError(t, request(t, a, "POST", "/api/admin/media-categories", input, host), 400, "invalid_media_category")
	}
	public := createTestCategory(t, a, host, "  Shared photos  ", true)
	private := createTestCategory(t, a, host, "Private surprise", false)
	if public.Name != "Shared photos" {
		t.Fatal("category name was not trimmed")
	}
	for _, test := range []struct {
		cookie *http.Cookie
		count  int
	}{{visitor, 1}, {host, 2}} {
		response := request(t, a, "GET", "/api/media-categories", nil, test.cookie)
		status(t, response, 200)
		var list struct {
			Items []MediaCategory `json:"items"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
		if len(list.Items) != test.count {
			t.Fatalf("unexpected visible categories: %s", response.Body.String())
		}
	}
	path := "/api/admin/media-categories/" + strconv.FormatInt(private.ID, 10)
	status(t, request(t, a, "PUT", path, map[string]any{"name": "Published surprise", "isPublic": true}, visitor), 403)
	status(t, request(t, a, "PUT", path, map[string]any{"name": "Published surprise", "isPublic": true}, host), 200)
	status(t, request(t, a, "PUT", "/api/admin/media-categories/99999", map[string]any{"name": "Missing", "isPublic": true}, host), 404)
	// Reservations must stay bounded even when two administrators create the final slot.
	if _, err := a.db.Exec("INSERT INTO media_categories(name,is_public) SELECT 'Reserved',false FROM generate_series(1,97)"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		wg.Go(func() {
			responses <- request(t, a, "POST", "/api/admin/media-categories", map[string]any{"name": "Last category", "isPublic": false}, host)
		})
	}
	wg.Wait()
	close(responses)
	counts := map[int]int{}
	for response := range responses {
		counts[response.Code]++
	}
	if counts[201] != 1 || counts[409] != 1 {
		t.Fatalf("category limit was not atomic: %v", counts)
	}
}

func TestMediaCategoryFiltersAndPrivacyApplyToEveryResource(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, _, _ := guest(t, a, host, "Uploader")
	other, _, _ := guest(t, a, host, "Viewer")
	category := createTestCategory(t, a, host, "Shared", true)
	main := finishCategoryUpload(t, a, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, nil, "")))
	first := finishCategoryUpload(t, a, performMediaUpload(a, mediaUploadRequest(t, visitor, &category.ID, nil, "")))
	accepted := performMediaUpload(a, mediaUploadRequest(t, visitor, &category.ID, nil, "11111111-1111-4111-8111-111111111111"))
	second := finishCategoryUpload(t, a, accepted)
	jobID := parseJob(t, accepted).ID
	categoryPath := "/api/photos?categoryId=" + strconv.FormatInt(category.ID, 10)
	for _, test := range []struct {
		path string
		id   int64
		next bool
	}{
		{"/api/photos?limit=1", main.ID, false},
		{categoryPath + "&limit=1", second.ID, true},
		{categoryPath + "&limit=1&before=" + strconv.FormatInt(second.ID, 10), first.ID, false},
	} {
		response := request(t, a, "GET", test.path, nil, other)
		status(t, response, 200)
		var list struct {
			Items []Photo `json:"items"`
			Next  *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
		if len(list.Items) != 1 || list.Items[0].ID != test.id || (list.Next != nil) != test.next {
			t.Fatalf("wrong filtered page: %s", response.Body.String())
		}
	}
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, nil, nil, "11111111-1111-4111-8111-111111111111")), 400, "invalid_media_category")
	status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": false}, host), 200)
	for _, cookie := range []*http.Cookie{visitor, other} {
		assertWelcomeError(t, request(t, a, "GET", categoryPath, nil, cookie), 404, "media_category_not_found")
		for _, path := range []string{second.URL, second.ThumbnailURL} {
			for _, method := range []string{"GET", "HEAD"} {
				r := httptest.NewRequest(method, path, nil)
				r.AddCookie(cookie)
				r.Header.Set("Range", "bytes=0-3")
				assertWelcomeError(t, performMediaUpload(a, r), 404, "photo_not_found")
			}
		}
		assertWelcomeError(t, request(t, a, "DELETE", "/api/photos/"+strconv.FormatInt(second.ID, 10), nil, cookie), 404, "photo_not_found")
	}
	assertWelcomeError(t, performMediaUpload(a, mediaUploadRequest(t, visitor, &category.ID, nil, "")), 404, "media_category_not_found")
	response := request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(jobID, 10), nil, visitor)
	status(t, response, 200)
	job := parseJob(t, response)
	if job.Photo != nil || job.CategoryID == nil || *job.CategoryID != category.ID {
		t.Fatal("private job exposed media or lost destination")
	}
	if strings.Contains(request(t, a, "GET", "/api/uploads", nil, visitor).Body.String(), second.URL) {
		t.Fatal("private media leaked through queue list")
	}
	status(t, request(t, a, "GET", second.URL, nil, host), 200)
	status(t, request(t, a, "GET", categoryPath, nil, host), 200)
	status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": true}, host), 200)
	status(t, request(t, a, "GET", second.URL, nil, other), 200)
	if parseJob(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(jobID, 10), nil, visitor)).Photo == nil {
		t.Fatal("published category stayed hidden")
	}
	status(t, request(t, a, "DELETE", "/api/photos/"+strconv.FormatInt(second.ID, 10), nil, other), 403)
	status(t, request(t, a, "DELETE", "/api/photos/"+strconv.FormatInt(second.ID, 10), nil, visitor), 204)
}

func TestMediaCategoryPrivacyAndSessionRecheckedAfterReception(t *testing.T) {
	for _, ending := range []string{"private", "logout", "revoke"} {
		t.Run(ending, func(t *testing.T) {
			a := testApp(t)
			host, _ := admin(t, a)
			visitor, identity, _ := guest(t, a, host, "Uploading guest")
			category := createTestCategory(t, a, host, "Initially public", true)
			r := mediaUploadRequest(t, visitor, &category.ID, nil, "")
			r.Body = io.NopCloser(&welcomeClosureReader{Reader: r.Body, onRead: func() {
				switch ending {
				case "private":
					status(t, request(t, a, "PUT", "/api/admin/media-categories/"+strconv.FormatInt(category.ID, 10), map[string]any{"name": category.Name, "isPublic": false}, host), 200)
				case "logout":
					status(t, request(t, a, "POST", "/api/logout", nil, visitor), 204)
				case "revoke":
					status(t, request(t, a, "DELETE", "/api/admin/guests/"+strconv.FormatInt(identity.ID, 10), nil, host), 204)
				}
			}})
			response := performMediaUpload(a, r)
			if ending == "private" {
				assertWelcomeError(t, response, 404, "media_category_not_found")
			} else {
				status(t, response, 401)
			}
			assertNoAcceptedMedia(t, a)
		})
	}
}

func assertNoAcceptedMedia(t *testing.T, a *App) {
	t.Helper()
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM upload_jobs").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rejected upload left jobs: %d, %v", count, err)
	}
	for _, directory := range []string{"tmp", "uploads"} {
		files, err := os.ReadDir(filepath.Join(a.config.DataDir, directory))
		if err != nil || len(files) != 0 {
			t.Fatalf("rejected upload retained %s files: %d, %v", directory, len(files), err)
		}
	}
}
