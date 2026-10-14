# Birthday API

Go owns identities, access checks, SQLite persistence, media and scheduled reveals.
The browser calls the same-origin Next.js `/api/*` proxy. Keep Go's listening port
private when deploying. The API contract is [docs/api.md](../docs/api.md).

## Run

From `backend/`, with Go 1.26 or newer:

Video uploads also require `ffmpeg` and `ffprobe` on `PATH`, including the
H.264 (`libx264`) and AAC encoders. The Docker image includes them. For local
development, install a build from the [FFmpeg download page](https://ffmpeg.org/download.html).

```sh
go mod download
go run ./cmd/server invite-admin --name "Your name"
go run ./cmd/server serve
```

The first command for the host prints a single-use invitation. Open the entire URL,
including its `#token=...` fragment, in the frontend. Repeating the command for the
same active administrator name issues a fresh invitation for the same identity.
From the repository root, the Node launcher also provides `npm run dev` and
`npm run backend -- invite-admin --name "Your name"`; see the root README.

Environment variables are read from the process, not automatically from `.env`.
See [.env.example](.env.example). Defaults are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LISTEN_ADDR` | `127.0.0.1:8080` | API listening address |
| `PUBLIC_URL` | `http://localhost:3000` | Exact browser origin and invitation base URL |
| `DATA_DIR` | `./data` | Private persistent SQLite database, originals, thumbnails |
| `COOKIE_SECURE` | Determined by `PUBLIC_URL` | HTTPS requires `true`; local HTTP uses `false` |
| `PRINT_ADMIN_INVITATION` | `false` (`true` in Compose) | Print a fresh administrator invitation at server startup |
| `MAX_IMAGE_SIZE_MB` | `15` | Maximum uploaded image size in MiB, integer 1–1024 |
| `MAX_VIDEO_SIZE_MB` | `100` | Maximum uploaded video size in MiB, integer 1–1024 |

Missing or empty upload limits use their defaults. Invalid values stop startup.
One MiB is 1,048,576 bytes. The gallery API returns the effective limits so the
frontend validates against the server settings. Compose applies changes from
the root `.env` when containers are recreated, without rebuilding images.

With `PRINT_ADMIN_INVITATION=true`, each server start prints
`Administrator invitation: <url>` after binding its listening socket. The oldest
active administrator is reused; if none exists, a technical `Admin` profile is
created. The new link replaces that administrator's previous invitation and keeps
existing sessions valid. It is single-use and expires after seven days. Revoked
administrators remain inactive, and regular guests are never promoted.

Compose enables this by default, using the root `.env` for overrides. To disable
it, set `PRINT_ADMIN_INVITATION=false` and run `docker compose up -d`. Use
`docker compose logs backend` to retrieve startup output. Running `up` again on an
unchanged, running backend does not issue a new invitation; restarting it does.
Invitation URLs use `PUBLIC_URL`, including any custom browser port. Ordinary
HTTP request logs never include these tokens.

## Behavior and limits

- Invite-only access. No signup or external message delivery. Hosts manually send
  the links generated in settings. Invitation tokens and session tokens contain
  32 cryptographically random bytes; only SHA-256 hashes are stored.
- Invitations expire in 7 days and are consumed transactionally by a deliberate
  POST. Previewing does not consume a link. Issuing a replacement invalidates the
  previous link and preserves identity. Re-inviting a revoked guest reactivates
  that identity; old sessions stay revoked.
- Sessions last 90 days, with at most 5 browser sessions per guest. Cookies use
  `HttpOnly`, `SameSite=Lax`, `Path=/` and `Secure` on HTTPS. Revoking a guest removes
  every session and pending invitation but retains contribution attribution.
- Mutations require `X-Requested-With: birthday-party`. A supplied Origin must
  exactly match `PUBLIC_URL`. Requests without Origin are accepted only with the
  custom header (CLI/testing); cross-origin browser preflights are not allowed.
- Invitation preview/accept are globally limited to 120 requests/minute. The
  limiter has constant memory and does not trust proxy address headers.
- All active guests can see everyone's photos, videos and messages. Only their author or
  a host can delete them. Every image request, including thumbnails, checks the
  current session; private media responses are not cached.
- Image uploads allow JPEG, PNG and WebP, at most `MAX_IMAGE_SIZE_MB` MiB
  (15 by default) and 40 megapixels. Two files can
  be processed concurrently. Files stream into a private temporary directory;
  invalid uploads are removed. Filenames are generated server-side.
- Thumbnails are JPEG, at most 720px on the longest side. Phone EXIF orientation is
  applied. Originals are retained unchanged, including embedded metadata, and
  remain accessible only to authenticated guests.
- Video uploads allow MP4, MOV and WebM up to `MAX_VIDEO_SIZE_MB` MiB
  (100 by default), 5 minutes and 4K input.
  FFmpeg converts them to H.264/AAC MP4, at most 1280×720 and 30 fps, and creates
  a JPEG thumbnail. The input video is discarded after conversion. Video
  processing has a five-minute timeout, bounded threads and restricted input
  formats/protocols. Each byte-range request checks the current session.
  Input limits apply before conversion. Converted output is bounded by the
  larger of 100 MiB and the configured video input limit; it may exceed the
  input limit for a small uploaded clip. Shortened conversions are rejected.
- The gallery is capped at 5000 files and 10 GiB. New upload accounting includes
  originals or normalized videos plus their thumbnails. Lists are paginated
  at 24 items by default, maximum 48. Hosts can manage up to 500 guest identities
  and 200 programme entries. These are initial explicit bounds, not performance
  claims.
- SQLite migrations use `PRAGMA user_version`; the initial migration is atomic.
  One connection serializes writes for this single-party app. WAL mode supports
  local CLI access while the service runs. Back up the complete data directory
  with the service stopped or use a consistent SQLite backup procedure.
- Guestbook posts can be anonymous. Their owner remains in SQLite for deletion
  permissions, but no API response includes that identity, even for hosts.
  The version 2 migration keeps existing entries named by default.
- Dates are normalized to UTC. The party starts with `Europe/Zurich` as its
  explicit, editable IANA timezone and an empty title on new databases. Existing
  titles remain unchanged; the frontend supplies a localized title when needed.
  The host may save an empty title to retain or restore this frontend fallback.
  An event becomes available at or after its
  unlock instant. Before that instant, guest responses contain only its public
  teaser and schedule; private title/description stay on the server. A missing
  teaser produces an empty title for the frontend's localized placeholder.
- API errors expose a stable `code` and an English fallback `error`. The frontend
  translates codes and formats dates for the browser's selected language. Go
  does not negotiate locale or translate host- and guest-authored content.
  Developer logs and CLI output remain in English.
- Data is retained until explicitly deleted. Hosting, backups and the desired
  end-of-party retention policy must be configured before publishing.

## Checks

```sh
gofmt -w cmd internal
go vet ./...
go test ./...
go build -o .cache/ ./cmd/server
```

Use `go test -race ./...` where cgo and a supported C compiler are installed.
The pure-Go application builds and runs without cgo; the race detector itself
requires it. Tests cover invitation reuse/expiry/concurrency, session revocation,
CSRF, private reveal boundaries, upload validation, ownership and persistence.
