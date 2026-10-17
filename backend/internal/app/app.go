// Package app composes feature services, HTTP authorization and background worker lifecycles.
package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
	_ "time/tzdata"

	"birthday-party/backend/internal/access"
	"birthday-party/backend/internal/adapters/avatar"
	"birthday-party/backend/internal/adapters/mediafiles"
	pgaccess "birthday-party/backend/internal/adapters/postgres/access"
	pgguestbook "birthday-party/backend/internal/adapters/postgres/guestbook"
	pgidentity "birthday-party/backend/internal/adapters/postgres/identity"
	pgmedia "birthday-party/backend/internal/adapters/postgres/media"
	pgnotifications "birthday-party/backend/internal/adapters/postgres/notifications"
	pgparty "birthday-party/backend/internal/adapters/postgres/party"
	pgprofile "birthday-party/backend/internal/adapters/postgres/profile"
	pgprogramme "birthday-party/backend/internal/adapters/postgres/programme"
	pgwelcome "birthday-party/backend/internal/adapters/postgres/welcome"
	"birthday-party/backend/internal/adapters/pushtransport"
	push "birthday-party/backend/internal/adapters/webpush"
	"birthday-party/backend/internal/guestbook"
	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
	"birthday-party/backend/internal/notifications"
	"birthday-party/backend/internal/party"
	"birthday-party/backend/internal/profile"
	"birthday-party/backend/internal/programme"
	"birthday-party/backend/internal/welcome"
)

// App owns the database pool, background workers and authenticated HTTP handlers.
// Construct it with Open and release its resources with Close.
type App struct {
	db                  *sql.DB
	identity            *identity.Service
	programme           *programme.Service
	guestbook           *guestbook.Service
	welcome             *welcome.Service
	profile             *profile.Service
	party               *party.Service
	access              *access.Service
	notifications       *notifications.Service
	media               *media.Service
	mediaStore          *pgmedia.Store
	mediaFiles          *mediafiles.Files
	config              Config
	now                 func() time.Time
	receivers           chan struct{}
	avatarProcessors    chan struct{}
	workerMu            sync.Mutex
	workerCancel        context.CancelFunc
	workerConn          *sql.Conn
	workerErrors        chan error
	workers             sync.WaitGroup
	closeOnce           sync.Once
	closeErr            error
	authMu              sync.Mutex
	authWindow          time.Time
	authCount           int
	notificationKeys    notifications.SigningKeys
	notificationSender  *push.Sender
	realtime            *realtimeHub
	programmeReschedule chan struct{}
}

// Open prepares private storage, opens PostgreSQL and applies pending migrations.
// It does not start workers; serving processes must call StartWorkers.
func Open(config Config) (*App, error) {
	subject, err := push.Subject(config.VAPIDSubject, config.PublicURL)
	if err != nil {
		return nil, err
	}
	config.VAPIDSubject = subject
	if config.MaxImageBytes == 0 {
		config.MaxImageBytes = defaultMaxImageBytes
	}
	if config.MaxVideoBytes == 0 {
		config.MaxVideoBytes = defaultMaxVideoBytes
	}
	if config.MaxImageBytes < 1<<20 || config.MaxImageBytes > maxConfiguredUploadBytes || config.MaxVideoBytes < 1<<20 || config.MaxVideoBytes > maxConfiguredUploadBytes {
		return nil, errors.New("upload limits must be between 1 MiB and 1024 MiB")
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "photos"), 0700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "tmp"), 0700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(config.DataDir, "uploads"), 0700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := openDatabase(ctx, config.DatabaseURL, config.DataDir)
	if err != nil {
		return nil, err
	}
	a := &App{
		db:                  db,
		identity:            identity.New(pgidentity.New(db), config.PublicURL),
		programme:           programme.New(pgprogramme.New(db)),
		guestbook:           guestbook.New(pgguestbook.New(db)),
		party:               party.New(pgparty.New(db)),
		access:              access.New(pgaccess.New(db)),
		config:              config,
		now:                 time.Now,
		receivers:           make(chan struct{}, 4),
		avatarProcessors:    make(chan struct{}, 1),
		workerErrors:        make(chan error, 1),
		realtime:            newRealtimeHub(),
		programmeReschedule: make(chan struct{}, 1),
	}
	clock := func() time.Time { return a.now() }
	a.profile = profile.New(pgprofile.New(db, clock), avatar.New())
	a.mediaStore = pgmedia.New(db, clock)
	a.mediaFiles = mediafiles.New(config.DataDir, config.MaxImageBytes, config.MaxVideoBytes)
	a.media = media.New(a.mediaStore, a.mediaFiles, clock, func(id int64) { a.realtime.notify(id, realtimeUploads) }, log.Printf)
	notificationStore := pgnotifications.New(db, clock)
	keys, err := notificationStore.LoadKeys(ctx, push.GenerateKeys)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("load notification keys: %w", err)
	}
	a.notificationKeys = keys
	a.notificationSender = push.New(keys, config.VAPIDSubject)
	a.notifications = notifications.New(notificationStore, a.notificationSender, pushtransport.ValidEndpoint, clock)
	a.welcome = welcome.New(pgwelcome.New(db, notificationStore.EnqueueWelcome))
	return a, nil
}

// Close cancels and waits for workers, releases their lock and closes the database.
// Repeated calls return the result of the first call.
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.realtime.close()
		a.workerMu.Lock()
		if a.workerCancel != nil {
			a.workerCancel()
		}
		a.workerMu.Unlock()
		a.workers.Wait()
		var releaseErr error
		if a.workerConn != nil {
			releaseErr = pgmedia.ReleaseWorkerConnection(a.workerConn)
		}
		a.closeErr = errors.Join(releaseErr, a.db.Close())
	})
	return a.closeErr
}
