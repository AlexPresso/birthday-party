package media

import (
	"context"
	"errors"
	"testing"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/welcome"
)

type repositoryStub struct {
	Repository
	accept      func(context.Context, int64, string, string, Received, Destination, func() error) (Upload, bool, error)
	publish     func(context.Context, Pending, Output) (bool, error)
	ready       func(context.Context, int64) (bool, error)
	requeue     func(context.Context, Pending, time.Time, time.Time) (bool, error)
	fail        func(context.Context, Pending, string, time.Time) (bool, error)
	photoFile   func(context.Context, identity.Guest, int64) (File, error)
	deletePhoto func(context.Context, identity.Guest, int64) (File, error)
}

func (r repositoryStub) Accept(ctx context.Context, id int64, client, key string, input Received, destination Destination, stage func() error) (Upload, bool, error) {
	return r.accept(ctx, id, client, key, input, destination, stage)
}
func (r repositoryStub) Publish(ctx context.Context, job Pending, output Output) (bool, error) {
	return r.publish(ctx, job, output)
}
func (r repositoryStub) Ready(ctx context.Context, id int64) (bool, error) { return r.ready(ctx, id) }
func (r repositoryStub) Requeue(ctx context.Context, job Pending, now, available time.Time) (bool, error) {
	return r.requeue(ctx, job, now, available)
}
func (r repositoryStub) Fail(ctx context.Context, job Pending, code string, now time.Time) (bool, error) {
	return r.fail(ctx, job, code, now)
}
func (r repositoryStub) PhotoFile(ctx context.Context, guest identity.Guest, id int64) (File, error) {
	return r.photoFile(ctx, guest, id)
}
func (r repositoryStub) DeletePhoto(ctx context.Context, guest identity.Guest, id int64) (File, error) {
	return r.deletePhoto(ctx, guest, id)
}

type filesStub struct {
	Files
	stage           func(Received, string) error
	prepare         func(context.Context, Pending) (Output, error)
	removedInputs   []string
	removedAttempts []Pending
}

func (f *filesStub) StageInput(input Received, key string) error { return f.stage(input, key) }
func (f *filesStub) Prepare(ctx context.Context, job Pending) (Output, error) {
	return f.prepare(ctx, job)
}
func (f *filesStub) RemoveInput(key string)    { f.removedInputs = append(f.removedInputs, key) }
func (f *filesStub) RemoveAttempt(job Pending) { f.removedAttempts = append(f.removedAttempts, job) }

func TestAcceptanceCoordinatesPromotionAndAmbiguousCommit(t *testing.T) {
	commitFailure := errors.New("commit response lost")
	for _, test := range []struct {
		name                     string
		promote, retain, success bool
		err                      error
	}{
		{"accepted", true, true, true, nil},
		{"idempotent existing upload", false, false, true, nil},
		{"rejected before file promotion", false, false, false, &Error{Code: "upload_queue_full"}},
		{"insert failed after promotion", true, false, false, errors.New("insert failed")},
		{"commit outcome uncertain", true, true, false, commitFailure},
	} {
		t.Run(test.name, func(t *testing.T) {
			staged := false
			notifications := 0
			insideRepository := false
			files := &filesStub{stage: func(input Received, key string) error {
				if !insideRepository || input.Path != "received" || key == "" {
					t.Fatal("input must be promoted within acceptance")
				}
				staged = true
				return nil
			}}
			repo := repositoryStub{accept: func(_ context.Context, id int64, client, key string, input Received, destination Destination, stage func() error) (Upload, bool, error) {
				if id != 7 || client != "client" || destination.SessionHash != "session" {
					t.Fatal("acceptance identity changed")
				}
				insideRepository = true
				defer func() { insideRepository = false }()
				if test.promote {
					if err := stage(); err != nil {
						t.Fatal(err)
					}
				}
				return Upload{ID: 42}, test.retain, test.err
			}}
			s := New(repo, files, time.Now, func(id int64) {
				if id != 7 {
					t.Fatal("wrong upload recipient")
				}
				notifications++
			}, func(string, ...any) {})
			job, err := s.Accept(t.Context(), 7, "client", Received{Path: "received"}, Destination{SessionHash: "session"})
			if job.ID != 42 || !errors.Is(err, test.err) || staged != test.promote {
				t.Fatalf("acceptance: job=%+v error=%v promoted=%v", job, err, staged)
			}
			if (len(files.removedInputs) == 0) != test.retain {
				t.Fatalf("retained input=%v, want %v", len(files.removedInputs) == 0, test.retain)
			}
			if (notifications == 1) != test.success {
				t.Fatalf("notification count=%d", notifications)
			}
		})
	}
}

func TestProcessingPreservesRetryableInputsAndCommitOutcomes(t *testing.T) {
	for _, test := range []struct {
		name                                         string
		prepareErr, publishErr                       error
		commitAttempted, ready, terminal, superseded bool
	}{
		{name: "published", commitAttempted: true},
		{name: "confirmed invalid media", prepareErr: &Error{Code: "unreadable_video"}, terminal: true},
		{name: "processor infrastructure failure", prepareErr: errors.New("processor unavailable")},
		{name: "ambiguous committed publication", publishErr: errors.New("commit response lost"), commitAttempted: true, ready: true},
		{name: "publication rejected before commit", publishErr: errors.New("database unavailable")},
		{name: "superseded attempt", publishErr: ErrSuperseded, superseded: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			job := Pending{ID: 9, GuestID: 4, Key: "input", Attempt: "attempt"}
			notifications, requeues, failures := 0, 0, 0
			files := &filesStub{prepare: func(context.Context, Pending) (Output, error) { return Output{Filename: "output"}, test.prepareErr }}
			repo := repositoryStub{
				publish: func(context.Context, Pending, Output) (bool, error) {
					return test.commitAttempted, test.publishErr
				},
				ready: func(context.Context, int64) (bool, error) { return test.ready, nil },
				requeue: func(ctx context.Context, actual Pending, _, _ time.Time) (bool, error) {
					requeues++
					if _, ok := ctx.Deadline(); !ok || actual.Attempt != job.Attempt {
						t.Fatal("retry needs bounded attempt update")
					}
					return true, nil
				},
				fail: func(ctx context.Context, actual Pending, code string, _ time.Time) (bool, error) {
					failures++
					if _, ok := ctx.Deadline(); !ok || code != "unreadable_video" || actual.Attempt != job.Attempt {
						t.Fatal("invalid terminal update")
					}
					return true, nil
				},
			}
			s := New(repo, files, time.Now, func(int64) { notifications++ }, func(string, ...any) {})
			s.Process(t.Context(), job)
			published := test.prepareErr == nil && test.publishErr == nil
			shouldRemove := published || test.ready || test.terminal
			if (len(files.removedInputs) == 1) != shouldRemove {
				t.Fatalf("input removal count=%d", len(files.removedInputs))
			}
			if (failures == 1) != test.terminal {
				t.Fatalf("terminal updates=%d", failures)
			}
			shouldRetry := !published && !test.ready && !test.terminal && !test.superseded
			if (requeues == 1) != shouldRetry {
				t.Fatalf("retry updates=%d", requeues)
			}
			if test.ready && len(files.removedAttempts) != 0 {
				t.Fatal("ambiguous committed output was removed")
			}
			if test.superseded && notifications != 0 {
				t.Fatal("superseded worker announced a change")
			}
		})
	}
}

func TestOutcomeIsRecordedOnceTheDatabaseReturns(t *testing.T) {
	for _, test := range []struct {
		name       string
		prepareErr error
		terminal   bool
	}{
		{"confirmed invalid media", &Error{Code: "unreadable_video"}, true},
		{"processor infrastructure failure", errors.New("processor unavailable"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := &filesStub{prepare: func(context.Context, Pending) (Output, error) { return Output{}, test.prepareErr }}
			updates, notifications := 0, 0
			update := func() (bool, error) {
				updates++
				if updates < 3 {
					if len(files.removedInputs) != 0 || notifications != 0 {
						t.Fatal("unrecorded outcome was announced or lost its input")
					}
					return false, errors.New("database unavailable")
				}
				return true, nil
			}
			repo := repositoryStub{
				ready:   func(context.Context, int64) (bool, error) { return false, nil },
				requeue: func(context.Context, Pending, time.Time, time.Time) (bool, error) { return update() },
				fail:    func(context.Context, Pending, string, time.Time) (bool, error) { return update() },
			}
			s := New(repo, files, time.Now, func(int64) { notifications++ }, func(string, ...any) {})
			s.recordRetry = time.Millisecond
			s.Process(t.Context(), Pending{ID: 1, Key: "input"})
			if updates != 3 || notifications != 1 {
				t.Fatalf("updates=%d notifications=%d", updates, notifications)
			}
			if (len(files.removedInputs) == 1) != test.terminal {
				t.Fatalf("input removals=%d", len(files.removedInputs))
			}
		})
	}
}

func TestStoppedWorkerLeavesUnrecordedOutcomeToRecovery(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	files := &filesStub{prepare: func(context.Context, Pending) (Output, error) { return Output{}, &Error{Code: "unreadable_video"} }}
	updates := 0
	repo := repositoryStub{fail: func(context.Context, Pending, string, time.Time) (bool, error) {
		updates++
		cancel()
		return false, errors.New("database unavailable")
	}}
	s := New(repo, files, time.Now, func(int64) { t.Fatal("uncommitted failure announced") }, func(string, ...any) {})
	s.recordRetry = time.Hour
	s.Process(ctx, Pending{ID: 1, Key: "input"})
	if updates != 1 || len(files.removedInputs) != 0 {
		t.Fatalf("updates=%d input removals=%d", updates, len(files.removedInputs))
	}
}

func TestWelcomeUploadRequiresStableSelectedWidgetAndDestination(t *testing.T) {
	revision, index, category := int64(8), int64(1), int64(3)
	view := welcome.View{ProgressRevision: revision, Step: &welcome.VisibleStep{Widgets: []welcome.Widget{{Type: "text", Text: "Instruction"}, {Type: "media_upload", MediaUpload: &welcome.MediaUpload{CategoryID: &category}}}}}
	destination := Destination{WelcomeRevision: &revision, WelcomeWidgetIndex: &index}
	if err := AuthorizeDestination(identity.Guest{Role: identity.RoleGuest}, view, &destination); err != nil || !SameOptionalID(destination.CategoryID, &category) {
		t.Fatalf("selected destination: %+v %v", destination, err)
	}
	changed := revision + 1
	destination.WelcomeRevision = &changed
	var failure *Error
	if err := AuthorizeDestination(identity.Guest{Role: identity.RoleGuest}, view, &destination); !errors.As(err, &failure) || failure.Code != "welcome_conflict" {
		t.Fatalf("stale revision accepted: %v", err)
	}
	destination = Destination{}
	if err := AuthorizeDestination(identity.Guest{Role: identity.RoleGuest}, view, &destination); !errors.As(err, &failure) || failure.Code != "invalid_body" {
		t.Fatalf("widget upload became ordinary upload: %v", err)
	}
	if err := AuthorizeDestination(identity.Guest{Role: identity.RoleAdmin}, view, &destination); err != nil {
		t.Fatalf("administrator access blocked: %v", err)
	}
}

func TestQueueAndAlbumCapacityBoundaries(t *testing.T) {
	if err := ValidateQueueCapacity(MaxQueuedUploads-1, MaxGuestUploads-1, MaxQueuedBytes-1, 1); err != nil {
		t.Fatal(err)
	}
	for _, err := range []error{ValidateQueueCapacity(MaxQueuedUploads, 0, 0, 1), ValidateQueueCapacity(0, MaxGuestUploads, 0, 1), ValidateQueueCapacity(0, 0, MaxQueuedBytes, 1)} {
		if err == nil {
			t.Fatal("queue overflow accepted")
		}
	}
	if err := ValidateAlbumCapacity(4999, MaxStoredBytes-1, 1); err != nil {
		t.Fatal(err)
	}
	if ValidateAlbumCapacity(5000, 0, 1) == nil || ValidateAlbumCapacity(1, MaxStoredBytes, 1) == nil {
		t.Fatal("album overflow accepted")
	}
}

func TestGuestCannotDeleteAnotherGuestsMedia(t *testing.T) {
	repo := repositoryStub{photoFile: func(context.Context, identity.Guest, int64) (File, error) { return File{AuthorID: 5}, nil }, deletePhoto: func(context.Context, identity.Guest, int64) (File, error) {
		t.Fatal("forbidden deletion reached repository")
		return File{}, nil
	}}
	s := New(repo, nil, time.Now, func(int64) { t.Fatal("forbidden deletion notified") }, func(string, ...any) {})
	var failure *Error
	if err := s.DeletePhoto(t.Context(), identity.Guest{ID: 4, Role: "guest"}, 1); !errors.As(err, &failure) || failure.Code != "photo_delete_forbidden" {
		t.Fatalf("deletion permission: %v", err)
	}
}

func TestFailingUploadWaitsLongerThenFailsAfterTheLastAttempt(t *testing.T) {
	now := time.Date(2026, 10, 17, 18, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name      string
		job       Pending
		cancelled bool
		wantDelay time.Duration
		wantCode  string
		prepared  bool
	}{
		{name: "first failure", job: Pending{Attempts: 1, Kind: KindImage}, wantDelay: 30 * time.Second, prepared: true},
		{name: "later failure", job: Pending{Attempts: MaxAttempts - 1, Kind: KindImage}, wantDelay: 15 * time.Minute, prepared: true},
		{name: "last image attempt", job: Pending{Attempts: MaxAttempts, Kind: KindImage}, wantCode: "photo_upload_failed", prepared: true},
		{name: "last video attempt", job: Pending{Attempts: MaxAttempts, Kind: KindVideo}, wantCode: "video_processing_failed", prepared: true},
		{name: "attempts lost without an outcome", job: Pending{Attempts: MaxAttempts + 1, Kind: KindVideo}, wantCode: "video_processing_failed"},
		{name: "interrupted worker retries promptly", job: Pending{Attempts: MaxAttempts, Kind: KindImage}, cancelled: true, prepared: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			test.job.ID, test.job.Key = 3, "input"
			prepared, requeued, failed := false, false, ""
			files := &filesStub{prepare: func(context.Context, Pending) (Output, error) {
				prepared = true
				if test.cancelled {
					cancel()
				}
				return Output{}, errors.New("storage unavailable")
			}}
			repo := repositoryStub{
				ready: func(context.Context, int64) (bool, error) { return false, nil },
				requeue: func(_ context.Context, _ Pending, _, available time.Time) (bool, error) {
					requeued = true
					if delay := available.Sub(now); delay != test.wantDelay {
						t.Fatalf("retry delay=%v, want %v", delay, test.wantDelay)
					}
					return true, nil
				},
				fail: func(_ context.Context, _ Pending, code string, _ time.Time) (bool, error) {
					failed = code
					return true, nil
				},
			}
			s := New(repo, files, func() time.Time { return now }, func(int64) {}, func(string, ...any) {})
			s.Process(ctx, test.job)
			if prepared != test.prepared {
				t.Fatalf("prepared=%v, want %v", prepared, test.prepared)
			}
			if failed != test.wantCode || requeued != (test.wantCode == "") {
				t.Fatalf("failed=%q requeued=%v", failed, requeued)
			}
			if (len(files.removedInputs) == 1) != (test.wantCode != "") {
				t.Fatalf("input removals=%d", len(files.removedInputs))
			}
		})
	}
}
