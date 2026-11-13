package app

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	guestidentity "birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
)

// Existing media tests exercise the eventual result; queue tests below also check acceptance.
func completeTestUpload(t *testing.T, a *App, cookie *http.Cookie, response *httptest.ResponseRecorder) *httptest.ResponseRecorder {
	t.Helper()
	if response.Code != 202 {
		return response
	}
	var accepted UploadJob
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	job, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if job.id != accepted.ID {
		t.Fatalf("claimed %d, expected %d", job.id, accepted.ID)
	}
	a.processUpload(context.Background(), job)
	result := request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.id, 10), nil, cookie)
	status(t, result, 200)
	var completed UploadJob
	if err = json.Unmarshal(result.Body.Bytes(), &completed); err != nil {
		t.Fatal(err)
	}
	final := httptest.NewRecorder()
	if completed.Status == "ready" {
		respond(final, 201, completed.Photo)
		return final
	}
	if completed.Status != "failed" || completed.ErrorCode == nil {
		t.Fatalf("upload did not complete: %s", result.Body.String())
	}
	fail(final, *completed.ErrorCode)
	return final
}

func queuedUpload(t *testing.T, a *App, cookie *http.Cookie, id string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "holiday.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/photos", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.Header.Set("X-Requested-With", "birthday-party")
	r.Header.Set("X-Upload-ID", id)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func parseJob(t *testing.T, response *httptest.ResponseRecorder) UploadJob {
	t.Helper()
	var job UploadJob
	if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil {
		t.Fatal(err)
	}
	return job
}

func waitForUpload(t *testing.T, a *App, cookie *http.Cookie, id int64, want media.Status) UploadJob {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response := request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(id, 10), nil, cookie)
		status(t, response, 200)
		job := parseJob(t, response)
		if job.Status == want {
			return job
		}
		if job.Status == "failed" {
			t.Fatalf("unexpected failed upload: %s", response.Body.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("upload %d did not reach %s", id, want)
	return UploadJob{}
}

func TestUploadQueueIsDurablePrivateAndIdempotent(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	one, _, _ := guest(t, a, host, "One")
	two, _, _ := guest(t, a, host, "Two")
	id := "11111111-1111-4111-8111-111111111111"
	data := pngBytes(t)
	response := queuedUpload(t, a, one, id, data)
	status(t, response, 202)
	job := parseJob(t, response)
	if job.Status != "queued" || job.Photo != nil || job.ErrorCode != nil || job.ClientUploadID != id {
		t.Fatalf("unexpected accepted job: %+v", job)
	}
	status(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.ID, 10), nil, two), 404)
	status(t, request(t, a, "GET", "/api/uploads/"+strconv.FormatInt(job.ID, 10), nil, host), 404)
	if strings.Contains(request(t, a, "GET", "/api/uploads", nil, two).Body.String(), "holiday.png") {
		t.Fatal("another guest can see upload filenames")
	}
	if got := parseJob(t, queuedUpload(t, a, one, id, data)); got.ID != job.ID {
		t.Fatal("retry created a duplicate upload")
	}
	if got := parseJob(t, queuedUpload(t, a, two, id, data)); got.ID == job.ID {
		t.Fatal("idempotency key leaked across guests")
	}
	// A crash may leave a processing job; startup recovers it from durable raw input.
	if _, err := a.claimUpload(context.Background()); err != nil {
		t.Fatal(err)
	}
	config, clock := a.config, a.now
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.now = clock
	if err = reopened.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	finished := waitForUpload(t, reopened, one, job.ID, "ready")
	if finished.Photo == nil || finished.Photo.Width != 12 {
		t.Fatalf("invalid completed photo: %+v", finished)
	}
	status(t, request(t, reopened, "GET", finished.Photo.URL, nil, two), 200)
	status(t, request(t, reopened, "DELETE", "/api/photos/"+strconv.FormatInt(finished.Photo.ID, 10), nil, one), 204)
	deleted := parseJob(t, request(t, reopened, "GET", "/api/uploads/"+strconv.FormatInt(job.ID, 10), nil, one))
	if deleted.Status != "ready" || deleted.Photo != nil {
		t.Fatal("deleting media broke upload history")
	}
}

func TestUploadWorkersAcceptConcurrentUploadsAndSerializeQuota(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	data := pngBytes(t)
	const count = 12
	var wg sync.WaitGroup
	responses := make([]*httptest.ResponseRecorder, count)
	for i := range count {
		wg.Add(1)
		go func() { defer wg.Done(); responses[i] = queuedUpload(t, a, host, "", data) }()
	}
	wg.Wait()
	for _, response := range responses {
		status(t, response, 202)
	}
	if err := a.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, response := range responses {
		waitForUpload(t, a, host, parseJob(t, response).ID, "ready")
	}
	var stored int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM photos").Scan(&stored); err != nil || stored != count {
		t.Fatalf("photos=%d error=%v", stored, err)
	}
}

func TestUploadQueueQuotaRevocationFailureAndCleanup(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	data := pngBytes(t)
	response := queuedUpload(t, a, host, "", data)
	status(t, response, 202)
	job := parseJob(t, response)
	if _, err := a.db.Exec("UPDATE upload_jobs SET byte_size=$1", maxQueuedBytes); err != nil {
		t.Fatal(err)
	}
	status(t, queuedUpload(t, a, host, "", data), 409)
	files, err := os.ReadDir(filepath.Join(a.config.DataDir, "uploads"))
	if err != nil || len(files) != 1 {
		t.Fatalf("queue quota leaked raw inputs: %v %v", files, err)
	}
	if _, err = a.db.Exec("UPDATE guests SET active=FALSE WHERE id=$1", identity.ID); err != nil {
		t.Fatal(err)
	}
	pending, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(context.Background(), pending)
	completed, err := a.uploadByID(context.Background(), job.ID, identity.ID)
	if err != nil || completed.Status != "failed" || completed.ErrorCode == nil || *completed.ErrorCode != "access_revoked" {
		t.Fatalf("revoked upload completed: %+v %v", completed, err)
	}
	assertMediaFiles(t, a, 0)
	if _, err = a.db.Exec("UPDATE upload_jobs SET updated_at=$1", a.now().Add(-25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err = a.cleanUploadHistory(context.Background()); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err = a.db.QueryRow("SELECT COUNT(*) FROM upload_jobs").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("expired history remains: %d %v", remaining, err)
	}
}

func TestOnlyOneServingProcessCanOwnMediaWorkers(t *testing.T) {
	a := testApp(t)
	if err := a.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	other, err := Open(a.config)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = other.StartWorkers(context.Background()); err == nil {
		t.Fatal("second process acquired media worker ownership")
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	if err = other.StartWorkers(context.Background()); err != nil {
		t.Fatalf("worker ownership not released: %v", err)
	}
}

func TestCancelledMediaProcessingKeepsInputForRetry(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	job, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a.processUpload(ctx, job)
	queued, err := a.uploadByID(context.Background(), job.id, identity.ID)
	if err != nil || queued.Status != "queued" {
		t.Fatalf("cancelled job lost: %+v %v", queued, err)
	}
	if _, err = os.Stat(filepath.Join(a.config.DataDir, "uploads", job.key+".input")); err != nil {
		t.Fatal("raw input removed before successful commit")
	}
	job, err = a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(context.Background(), job)
	ready, err := a.uploadByID(context.Background(), job.id, identity.ID)
	if err != nil || ready.Status != "ready" {
		t.Fatalf("retry failed: %+v %v", ready, err)
	}
	assertMediaFiles(t, a, 2)
}

func TestUploadCommitFailureCanRecoverWithoutLosingInput(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	// A deferred failure happens during Commit, after playback files were written.
	_, err := a.db.Exec(`CREATE FUNCTION reject_photo_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected commit failure'; END $$;
CREATE CONSTRAINT TRIGGER reject_photo_commit AFTER INSERT ON photos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_photo_commit()`)
	if err != nil {
		t.Fatal(err)
	}
	job, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(context.Background(), job)
	queued, err := a.uploadByID(context.Background(), job.id, identity.ID)
	if err != nil || queued.Status != "queued" {
		t.Fatalf("commit failure did not requeue: %+v %v", queued, err)
	}
	if _, err = os.Stat(filepath.Join(a.config.DataDir, "uploads", job.key+".input")); err != nil {
		t.Fatal("commit failure lost raw input")
	}
	if _, err = a.db.Exec("DROP TRIGGER reject_photo_commit ON photos; DROP FUNCTION reject_photo_commit()"); err != nil {
		t.Fatal(err)
	}
	advanceClock(a, time.Minute)
	job, err = a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(context.Background(), job)
	ready, err := a.uploadByID(context.Background(), job.id, identity.ID)
	if err != nil || ready.Status != "ready" {
		t.Fatalf("commit retry failed: %+v %v", ready, err)
	}
	assertMediaFiles(t, a, 2)
}

func TestUploadIDsAndConcurrentRetries(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	data := pngBytes(t)
	for _, id := range []string{"not-an-id", "00000000-0000-0000-0000-000000000000", "11111111-1111-4111-1111-111111111111"} {
		response := queuedUpload(t, a, host, id, data)
		status(t, response, 400)
		if !strings.Contains(response.Body.String(), `"code":"invalid_upload_id"`) {
			t.Fatal(response.Body.String())
		}
	}
	const id = "11111111-1111-4111-8111-111111111111"
	var wg sync.WaitGroup
	responses := make([]*httptest.ResponseRecorder, 8)
	for i := range responses {
		wg.Add(1)
		go func() { defer wg.Done(); responses[i] = queuedUpload(t, a, host, id, data) }()
	}
	wg.Wait()
	var first int64
	for _, response := range responses {
		status(t, response, 202)
		job := parseJob(t, response)
		if first == 0 {
			first = job.ID
		}
		if first != job.ID {
			t.Fatal("concurrent retry created duplicate jobs")
		}
	}
	files, err := os.ReadDir(filepath.Join(a.config.DataDir, "uploads"))
	if err != nil || len(files) != 1 {
		t.Fatalf("duplicate spool files: %d %v", len(files), err)
	}
}

func TestUploadHistoryRemainsBoundedWithoutHidingActiveJobs(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	_, err := a.db.Exec(`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,available_at)
SELECT $1,'11111111-1111-4111-8111-'||lpad(n::text,12,'0'),CASE WHEN n<=100 THEN 'queued' ELSE 'ready' END,'file.png','image','png','test-'||n,1,$2,$2,$2 FROM generate_series(1,160) AS n`, identity.ID, a.now())
	if err != nil {
		t.Fatal(err)
	}
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 409)
	response = request(t, a, "GET", "/api/uploads", nil, host)
	status(t, response, 200)
	var page struct {
		Items []UploadJob `json:"items"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	active := 0
	for _, job := range page.Items {
		if job.Status == "queued" {
			active++
		}
	}
	if len(page.Items) != 150 || active != 100 {
		t.Fatalf("history bounds lost active jobs: total=%d active=%d", len(page.Items), active)
	}
}

func TestMediaWorkerLockLossIsReportedForRestart(t *testing.T) {
	a := testApp(t)
	if err := a.StartWorkers(context.Background()); err != nil {
		t.Fatal(err)
	}
	var pid int
	if err := a.workerConn.QueryRowContext(context.Background(), "SELECT pg_backend_pid()").Scan(&pid); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("SELECT pg_terminate_backend($1)", pid); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-a.WorkerErrors():
		if !strings.Contains(err.Error(), "lock connection lost") {
			t.Fatal(err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("lost worker lock did not stop serving process")
	}
}

func TestSupersededWorkerCannotPublishOrFailAnotherAttempt(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	stale, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a new serving process recovering the job after losing the old lease.
	if _, err = a.db.Exec("UPDATE upload_jobs SET status='queued' WHERE id=$1", stale.id); err != nil {
		t.Fatal(err)
	}
	current, err := a.claimUpload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	a.processUpload(context.Background(), stale)
	job, err := a.uploadByID(context.Background(), stale.id, identity.ID)
	if err != nil || job.Status != "processing" {
		t.Fatalf("old worker changed newer attempt: %+v %v", job, err)
	}
	if _, err = os.Stat(filepath.Join(a.config.DataDir, "uploads", stale.key+".input")); err != nil {
		t.Fatal("old worker removed newer attempt's input")
	}
	a.processUpload(context.Background(), current)
	// A late failure in the old worker must not remove the completed playback files.
	a.processUpload(context.Background(), stale)
	job, err = a.uploadByID(context.Background(), stale.id, identity.ID)
	if err != nil || job.Status != "ready" || job.Photo == nil {
		t.Fatalf("old worker damaged completed upload: %+v %v", job, err)
	}
	status(t, request(t, a, "GET", job.Photo.URL, nil, host), 200)
	var count int
	if err = a.db.QueryRow("SELECT COUNT(*) FROM photos").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate photo: %d %v", count, err)
	}
	assertMediaFiles(t, a, 2)
}

func TestStartupRecoveryWaitsForAnUploadCommit(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	tx, err := a.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		t.Fatal(err)
	}
	key, err := guestidentity.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	data := pngBytes(t)
	if err = os.WriteFile(filepath.Join(a.config.DataDir, "uploads", key+".input"), data, 0600); err != nil {
		t.Fatal(err)
	}
	var id int64
	err = tx.QueryRow(`INSERT INTO upload_jobs(guest_id,client_upload_id,status,filename,kind,input_format,storage_key,byte_size,created_at,updated_at,available_at)
VALUES($1,'11111111-1111-4111-8111-111111111111','queued','photo.png','image','png',$2,$3,$4,$4,$4) RETURNING id`, identity.ID, key, len(data), a.now()).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan error, 1)
	go func() { started <- a.StartWorkers(context.Background()) }()
	select {
	case err := <-started:
		t.Fatalf("startup bypassed the in-flight upload reservation: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-started:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("startup did not resume after upload commit")
	}
	job := waitForUpload(t, a, host, id, "ready")
	status(t, request(t, a, "GET", job.Photo.URL, nil, host), 200)
}
