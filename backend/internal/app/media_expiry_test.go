package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"birthday-party/backend/internal/identity"
	"birthday-party/backend/internal/media"
)

func TestMediaRejectsSessionsExpiringWhileWaitingForGuestLock(t *testing.T) {
	for _, operation := range []string{"inspect", "accept"} {
		t.Run(operation, func(t *testing.T) {
			a := testApp(t)
			var current atomic.Int64
			current.Store(a.now().Unix())
			a.now = func() time.Time { return time.Unix(current.Load(), 0) }
			host, _ := admin(t, a)
			visitor, guest, _ := guest(t, a, host, "Waiting uploader")
			expires := current.Load() + 1
			if _, err := a.db.Exec("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", expires, identity.HashToken(visitor.Value)); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			lock, err := a.db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Rollback()
			var holder int
			if err := lock.QueryRowContext(ctx, "SELECT pg_backend_pid() FROM guests WHERE id=$1 FOR UPDATE", guest.ID).Scan(&holder); err != nil {
				t.Fatal(err)
			}
			input := media.Received{Path: filepath.Join(a.config.DataDir, "tmp", "expiry.png"), Filename: "photo.png", Kind: "image", Format: "png"}
			data := pngBytes(t)
			input.Size = int64(len(data))
			if err := os.WriteFile(input.Path, data, 0600); err != nil {
				t.Fatal(err)
			}
			clientID, err := media.NewUploadID()
			if err != nil {
				t.Fatal(err)
			}
			destination := media.Destination{SessionHash: identity.HashToken(visitor.Value)}
			result := make(chan error, 1)
			go func() {
				if operation == "inspect" {
					_, err := a.media.Inspect(ctx, guest.ID, clientID, &destination)
					result <- err
					return
				}
				_, err := a.media.Accept(ctx, guest.ID, clientID, input, destination)
				result <- err
			}()
			for {
				var blocked bool
				if err := a.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))", holder).Scan(&blocked); err != nil {
					t.Fatal(err)
				}
				if blocked {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("upload did not reach guest lock")
				case <-time.After(5 * time.Millisecond):
				}
			}
			current.Store(expires)
			if err := lock.Rollback(); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-result:
				var failure *media.Error
				if !errors.As(err, &failure) || failure.Code != "session_expired" {
					t.Fatalf("expired upload session accepted: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("upload did not finish after releasing guest lock")
			}
			var count int
			if err := a.db.QueryRow("SELECT COUNT(*) FROM upload_jobs WHERE guest_id=$1", guest.ID).Scan(&count); err != nil || count != 0 {
				t.Fatalf("expired session queued media: count=%d error=%v", count, err)
			}
			files, err := os.ReadDir(filepath.Join(a.config.DataDir, "uploads"))
			if err != nil || len(files) != 0 {
				t.Fatalf("expired session promoted input: files=%d error=%v", len(files), err)
			}
		})
	}
}
