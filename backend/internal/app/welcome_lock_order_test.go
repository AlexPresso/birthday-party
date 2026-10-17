package app

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWelcomeEnrollmentLocksGuestBeforeSharedSequence(t *testing.T) {
	a := testApp(t)
	host, _ := admin(t, a)
	visitor, identity, _ := guest(t, a, host, "Concurrent enrollment")
	state := changeWelcome(t, a, host, 0, "start")
	upload, err := a.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer upload.Rollback()
	var uploadPID int
	if err = upload.QueryRowContext(t.Context(), "SELECT pg_backend_pid() FROM guests WHERE id=$1 FOR UPDATE", identity.ID).Scan(&uploadPID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	response := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", "/api/welcome", nil).WithContext(ctx)
		r.AddCookie(visitor)
		recorder := httptest.NewRecorder()
		a.Handler().ServeHTTP(recorder, r)
		response <- recorder
	}()

	// Wait until enrollment reaches the guest lock held by upload acceptance.
	for {
		var blocked bool
		err = a.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))", uploadPID).Scan(&blocked)
		if err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Enrollment must not hold welcome while waiting for the guest: a queued
	// host update would otherwise block upload's later welcome SHARE lock.
	hostContext, cancelHost := context.WithTimeout(t.Context(), 500*time.Millisecond)
	defer cancelHost()
	_, hostError := a.db.ExecContext(hostContext, "UPDATE welcome SET revision=revision+1 WHERE id=1")
	if err = upload.Rollback(); err != nil {
		t.Fatal(err)
	}
	status(t, <-response, 200)
	if hostError != nil {
		t.Fatalf("welcome enrollment inverted the guest/welcome lock order: %v", hostError)
	}
	view := readGuestWelcome(t, a, visitor)
	if view.Revision != state.Revision+1 || view.ProgressRevision == 0 || view.Step != nil {
		t.Fatalf("concurrent enrollment lost state: %+v", view)
	}
}
