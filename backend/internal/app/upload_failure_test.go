package app

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"birthday-party/backend/internal/media"

	"github.com/jackc/pgx/v5"
)

func TestMissingProcessingStorageKeepsUploadForRetry(t *testing.T) {
	for _, directory := range []string{"tmp", "photos"} {
		t.Run(directory, func(t *testing.T) {
			a := testApp(t)
			host, identity := admin(t, a)
			response := queuedUpload(t, a, host, "", pngBytes(t))
			status(t, response, 202)
			job, err := a.claimUpload(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			storage := filepath.Join(a.config.DataDir, directory)
			if err = os.Remove(storage); err != nil {
				t.Fatal(err)
			}
			a.processUpload(t.Context(), job)
			queued, err := a.uploadByID(t.Context(), job.id, identity.ID)
			if err != nil || queued.Status != "queued" || queued.ErrorCode != nil {
				t.Fatalf("storage failure did not preserve the job: %+v %v", queued, err)
			}
			if _, err = os.Stat(filepath.Join(a.config.DataDir, "uploads", job.key+".input")); err != nil {
				t.Fatalf("storage failure removed original input: %v", err)
			}
			if err = os.Mkdir(storage, 0700); err != nil {
				t.Fatal(err)
			}
			if _, err = a.claimUpload(t.Context()); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("failed upload was retried without waiting: %v", err)
			}
			advanceClock(a, time.Minute)
			job, err = a.claimUpload(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			a.processUpload(t.Context(), job)
			ready, err := a.uploadByID(t.Context(), job.id, identity.ID)
			if err != nil || ready.Status != "ready" {
				t.Fatalf("retry after restoring storage failed: %+v %v", ready, err)
			}
		})
	}
}

func TestMissingOriginalFailsUpload(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	job, err := a.claimUpload(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(a.config.DataDir, "uploads", job.key+".input")); err != nil {
		t.Fatal(err)
	}
	a.processUpload(t.Context(), job)
	failed, err := a.uploadByID(t.Context(), job.id, identity.ID)
	if err != nil || failed.Status != "failed" || failed.ErrorCode == nil || *failed.ErrorCode != "photo_unavailable" {
		t.Fatalf("missing input did not fail the job: %+v %v", failed, err)
	}
}

func TestRetryableUploadDoesNotStarveLaterJobs(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	a := testApp(t)
	host, identity := admin(t, a)
	// Reception recognizes the container header; probing fails because the tool
	// is unavailable, before it can validate this deliberately incomplete input.
	video := queuedUpload(t, a, host, "", []byte("\x00\x00\x00\x18ftypisom"))
	status(t, video, 202)
	image := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, image, 202)
	first, err := a.claimUpload(t.Context())
	if err != nil || first.id != parseJob(t, video).ID {
		t.Fatalf("first upload was not claimed: %+v %v", first, err)
	}
	retryTime := a.now().Add(time.Second)
	a.now = func() time.Time { return retryTime }
	a.processUpload(t.Context(), first)
	second, err := a.claimUpload(t.Context())
	if err != nil || second.id != parseJob(t, image).ID {
		t.Fatalf("retrying upload blocked a later image: %+v %v", second, err)
	}
	a.processUpload(t.Context(), second)
	ready, err := a.uploadByID(t.Context(), second.id, identity.ID)
	if err != nil || ready.Status != "ready" {
		t.Fatalf("later image did not complete: %+v %v", ready, err)
	}
	queued, err := a.uploadByID(t.Context(), first.id, identity.ID)
	if err != nil || queued.Status != "queued" {
		t.Fatalf("video was not preserved for retry: %+v %v", queued, err)
	}
	if _, err = os.Stat(filepath.Join(a.config.DataDir, "uploads", first.key+".input")); err != nil {
		t.Fatalf("missing tool caused original input to be removed: %v", err)
	}
}

func TestWorkerQueriesHaveDeadlines(t *testing.T) {
	a := testApp(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "LOCK TABLE upload_jobs IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	go func() { results <- a.cleanUploadHistory(ctx) }()
	go func() { _, err := a.claimUpload(ctx); results <- err }()
	deadline := time.NewTimer(2 * workerQueryTimeout)
	defer deadline.Stop()
	for range 2 {
		select {
		case err := <-results:
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("blocked worker query returned %v, want deadline exceeded", err)
			}
		case <-deadline.C:
			t.Fatal("blocked worker queries exceeded their deadline")
		}
	}
}

func TestFailedWorkerStartupReleasesOwnership(t *testing.T) {
	a := testApp(t)
	tx, err := a.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(t.Context(), "SELECT pg_advisory_xact_lock(hashtext(current_schema()),73003)"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	if err = a.StartWorkers(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked startup returned %v, want deadline exceeded", err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	other, err := Open(a.config)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = other.StartWorkers(t.Context()); err != nil {
		t.Fatalf("failed startup retained queue ownership: %v", err)
	}
}

func TestFailedWorkerUnlockDiscardsConnection(t *testing.T) {
	a := testApp(t)
	conn, err := a.db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var schema string
	if err = conn.QueryRowContext(t.Context(), "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.ExecContext(t.Context(), "SELECT pg_advisory_lock(hashtext(current_schema()),73002)"); err != nil {
		t.Fatal(err)
	}
	// Shadow unlock only in this isolated test schema and connection. The real
	// session lock remains held unless releaseWorkerConnection discards it.
	if _, err = conn.ExecContext(t.Context(), `CREATE FUNCTION pg_advisory_unlock(integer,integer) RETURNS boolean
 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected unlock failure'; END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.ExecContext(t.Context(), "SET search_path="+pgx.Identifier{schema}.Sanitize()+",pg_catalog"); err != nil {
		t.Fatal(err)
	}
	// Pin a distinct connection before release; reacquiring on the same session
	// would succeed reentrantly even if it still held the lock.
	other, err := a.db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer releaseWorkerConnection(other)
	if err = releaseWorkerConnection(conn); err == nil {
		t.Fatal("unlock failure was not returned")
	}
	ctx, cancel := context.WithTimeout(t.Context(), workerQueryTimeout)
	defer cancel()
	if _, err = other.ExecContext(ctx, "SELECT pg_advisory_lock(hashtext(current_schema()),73002)"); err != nil {
		t.Fatalf("failed unlock retained worker ownership: %v", err)
	}
}

func TestUploadThatKeepsFailingStopsAfterItsLastAttempt(t *testing.T) {
	a := testApp(t)
	host, identity := admin(t, a)
	response := queuedUpload(t, a, host, "", pngBytes(t))
	status(t, response, 202)
	if err := os.Remove(filepath.Join(a.config.DataDir, "tmp")); err != nil {
		t.Fatal(err)
	}
	var key string
	for attempt := 1; attempt <= media.MaxAttempts; attempt++ {
		job, err := a.claimUpload(t.Context())
		if err != nil || job.attempts != attempt {
			t.Fatalf("attempt %d: claimed %+v: %v", attempt, job, err)
		}
		key = job.key
		a.processUpload(t.Context(), job)
		current, err := a.uploadByID(t.Context(), job.id, identity.ID)
		if err != nil {
			t.Fatal(err)
		}
		if attempt < media.MaxAttempts {
			if current.Status != "queued" || current.ErrorCode != nil {
				t.Fatalf("attempt %d ended the job early: %+v", attempt, current)
			}
			advanceClock(a, time.Hour)
			continue
		}
		if current.Status != "failed" || current.ErrorCode == nil || *current.ErrorCode != "photo_upload_failed" {
			t.Fatalf("exhausted upload was not failed: %+v", current)
		}
	}
	if _, err := a.claimUpload(t.Context()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("failed upload was claimed again: %v", err)
	}
	if _, err := os.Stat(filepath.Join(a.config.DataDir, "uploads", key+".input")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed upload kept its input: %v", err)
	}
}
