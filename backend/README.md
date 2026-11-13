# Birthday API

Go owns identities, access checks, PostgreSQL persistence, media and scheduled reveals.
The browser calls the same-origin Next.js `/api/*` proxy, including the authenticated
`/api/realtime` WebSocket. Welcome, upload queue and programme updates use scoped
signals followed by authorized HTTP reads. No browser HTTP polling is required.
Connections reconnect and resynchronize after interruptions. Keep Go's listening port
private when deploying. The API contract is [docs/api.md](../docs/api.md).

## Code organization

The backend uses hexagonal architecture organized by feature. `cmd/server` wires
configuration, commands and the HTTP server. `internal/app` composes services and
concrete adapters, translates HTTP requests/errors, and owns database bootstrap,
realtime connections and worker startup/shutdown.

Core packages keep models, rules, concrete services and required ports together:
`access`, `identity`, `programme`, `guestbook`, `welcome`, `profile`, `party`,
`media` and `notifications`. Their ports use domain types and have no dependency
on SQL, HTTP handlers, media libraries or infrastructure implementations.

- `internal/adapters/postgres/<feature>` implements persistence and complete atomic
  operations, including authorization rechecks and the established lock order.
- `internal/adapters/avatar` normalizes profile images.
- `internal/adapters/mediafiles` owns private media storage and image/video processing.
- `internal/adapters/preview` encodes thumbnails and avatars as opaque JPEGs.
- `internal/adapters/webpush` delivers notifications through the restricted
  HTTPS transport in `internal/adapters/pushtransport`.

The application passes adapters to services through constructors. PostgreSQL
transactions remain inside adapters; the core receives no SQL transaction handles.
Welcome transitions and notification enqueueing share one transaction through a
callback between the two PostgreSQL adapters. Realtime signals follow commits.

The schema lives in `internal/app/migrations`, starting from one baseline file.
Database bootstrap remains at the outer application boundary. `internal/timestamp`
and `internal/locale` hold the two conventions every feature shares: how instants
are written and which languages are supported. See [code organization](../docs/architecture.md) for ownership, dependency
rules and the testing strategy.

## Run

From `backend/`, with Go 1.27.2 or newer and `DATABASE_URL` pointing to PostgreSQL:

Video uploads also require `ffmpeg` and `ffprobe` on `PATH` for validation and
JPEG thumbnails. The Docker image includes them. For local
development, install a build from the [FFmpeg download page](https://ffmpeg.org/download.html).
Video test fixtures additionally use the H.264/AAC and VP9/Opus encoders.

```sh
go mod download
go run ./cmd/server invite-admin --name "Your name"
go run ./cmd/server serve
```

The first command for the host prints a single-use invitation. Open the entire URL,
including its `#token=...` fragment, in the frontend. Repeating the command for the
same active administrator name issues a fresh invitation for the same identity.
From the repository root, the Node launcher also provides `npm run dev` and
`npm run backend -- invite-admin --name "Your name"`; see [docs/development.md](../docs/development.md).

Environment variables are read from the process, not automatically from `.env`.
See [.env.example](.env.example). Defaults are:

| Variable                                     | Default                     | Purpose                                                                                      |
| -------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `LISTEN_ADDR`                                | `127.0.0.1:8080`            | API listening address                                                                        |
| `PUBLIC_URL`                                 | `http://localhost:3000`     | Exact browser origin and invitation base URL                                                 |
| `VAPID_SUBJECT`                              | HTTPS `PUBLIC_URL`          | Optional Web Push contact URI (`mailto:` or HTTPS); local HTTP uses a reserved placeholder   |
| `DATABASE_URL`                               | Required                    | PostgreSQL connection URL; standard PG environment variables are also supported              |
| `DATA_DIR`                                   | `./data`                    | Private media, thumbnails and durable pending inputs                                         |
| `COOKIE_SECURE`                              | Derived from `PUBLIC_URL`   | Optional: `true` for an HTTPS `PUBLIC_URL`, `false` for HTTP; `false` with HTTPS is rejected |
| `PRINT_ADMIN_INVITATION`                     | `false` (`true` in Compose) | Print a fresh administrator invitation at server startup                                     |
| `MAX_IMAGE_SIZE_MB`                          | `15`                        | Initial image upload limit in MiB, integer 1–1024, imported once                             |
| `MAX_VIDEO_SIZE_MB`                          | `100`                       | Initial video upload limit in MiB, integer 1–1024, imported once                             |
| `BIRTHDAY_AGE`                               | `30`                        | Initial birthday age, integer 1–150, imported once                                           |
| `INVITATION_TITLE`, `INVITATION_DESCRIPTION` | Localized defaults          | Initial public invitation text; optional `_EN`, `_FR`, `_DE`, `_IT`, `_ES` overrides         |

On initial import, missing or empty upload limits use their defaults and invalid
values stop startup. Once settings are saved, legacy environment values are ignored.
One MiB is 1,048,576 bytes. The gallery API returns the effective limits so the
frontend validates against the server settings. Existing root environment values
are imported once into PostgreSQL. Administrators then edit age, invitation copy
and upload limits in Settings; changes apply on subsequent requests without
restarting. A null invitation text inherits and an empty string hides the text.
Public `/api/config` contains only age and invitation copy; admin reads and
writes use `/api/admin/config`. Network, storage and secrets remain in the environment.

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

- Invite-only access. No signup or automatic invitation delivery. Hosts manually send
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
- Hosts can close guest access and unlock an ordered welcome sequence. Until
  each guest has full access, they may accept invitations, check their session/current step and
  log out; party, programme, guestbook and media browsing endpoints return 423.
  The current step may include the profile and upload widgets described below.
  Administrators retain access. PostgreSQL stores up to 12 steps, the unlocked
  boundary and each guest's selected position. Waiting guests enter step one
  automatically on their next welcome refresh once it is available. Go persists
  the position and rotates its revision in the same transaction. Later unlocks
  keep the current position; guests navigate forwards/backwards explicitly.
  Revision-checked transactions prevent duplicate advances. A global
  required switch makes late arrivals follow every step even after host opening.
  Existing participants enter explicitly when ready; required participants finish
  the steps first. Host opening unlocks all remaining steps. Access is
  open until the host explicitly starts waiting. Accepted uploads can finish
  privately while access is closed. See the API contract for commands and limits.
- Each welcome step contains 1–12 ordered widgets: titles, texts, profile photo
  and media uploads. Titles and texts are optional widget types, with limits of
  120 and 1000 Unicode code points respectively. Multiple upload widgets can
  choose separate destinations; at most one profile editor is allowed per step.
- Only while a `profile_photo` widget is current may a waiting guest read their
  own profile and save, remove or view their photo. Other guests' avatars and
  party content remain locked.
  Saving rechecks the guest's current widgets in the transaction. Host unlocks
  preserve the guest's position and active profile editor.
- A `media_upload` welcome widget accepts photos and videos into the main gallery
  or a category chosen by the host. Waiting guests can send files and check their
  own queue, without browsing media. Acceptance rechecks the guest progress revision
  and widget index and captures its destination; accepted jobs finish there after
  the step changes. Retries cannot switch widgets, including ones sharing a destination.
  Guest progress has its own revision tokens, so
  host unlocks do not invalidate transfers. Guest navigation or restarting the
  welcome invalidates the previous context; already accepted jobs keep processing.
- The `enable_notifications` widget has no settings and appears at most once per
  step. It lets guests subscribe their browser to Web Push during that selected
  step; full-access guests and administrators can also subscribe from Profile.
  Configuration, own status and removal require a session but no full-app access.
  Permission is checked again before saving, and each guest has at most 10 devices.
  PostgreSQL stores VAPID keys, session-bound subscriptions and a durable
  outbox. Keys are generated once, so a restart does not invalidate subscriptions.
  Host unlock/open commands queue a generic notification without waiting for an
  external push service. A separate worker coalesces pending updates and retries
  failed attempts within a bounded window; only a 2xx answer counts as delivered.
  Logout/revocation removes session
  subscriptions; delivery also checks guest activity and session expiry.
  Only event type and supported locale enter the payload. The service worker
  translates generic text and opens `/attente`; it never receives private content.
  Delivery allows public HTTPS destinations only, pins resolved addresses and
  disables redirects/proxies to prevent subscriptions from accessing private hosts.
  Notifications require HTTPS on phones; iOS/iPadOS require a Home Screen app.
- Hosts can create up to 100 media categories with names of 1–80 characters.
  Public categories are visible to guests with full app access. Private categories
  are visible only to administrators, including when the uploader requests their
  own file. Publishing a category later exposes its existing media without copying
  files. The default gallery contains uncategorized media; category views are
  separate filters within the same tab.
- Once full access is open, active guests can see shared photos, videos and
  messages. Only their author or a host can delete them, subject to category
  visibility. Every file request, including thumbnails, checks the current session,
  welcome access and category visibility. Photos, thumbnails, videos and avatars
  are sent with `Cache-Control: private, no-cache` and a strong `ETag`: a browser
  may keep them but revalidates every use, and a `304` is only answered after the
  same checks as a full response. JSON responses stay `no-store`.
- Guests can save or remove their own profile photo. JPEG, PNG and WebP inputs
  use the configured image byte limit and 40-megapixel limit. The upload is
  received under the shared reception limit; then a single bounded
  decoder applies orientation, center-crops and stores a metadata-free 256×256
  JPEG (at most 128 KiB) in PostgreSQL; the original is discarded. Replacements
  are atomic, and versioned image URLs require current session and welcome access.
  Anonymous guestbook posts never expose a profile photo or other author details.
- Image uploads allow JPEG, PNG and WebP, up to the saved image size limit
  (15 MiB by default) and 40 megapixels. Files stream into a private spool with
  server-generated storage names. A 202 response confirms a persistent job;
  two background workers prepare media independently of browser requests.
- The queue allows 100 active jobs per guest, 1000 overall and 10 GiB of pending
  inputs. Four incoming files can stream concurrently; further receivers wait.
  Guests can read only their own jobs, including the 50 most recent terminal
  results. Terminal history expires after 24 hours; published media is retained.
  `X-Upload-ID` UUIDs prevent duplicate jobs on ambiguous network retries.
  Confirmed invalid uploads fail and discard input; submitting the file again
  uses a new upload ID. Infrastructure failures retain input and retry, including
  missing video tools, cancellation and storage failures. Unknown video command
  failures also retry conservatively rather than risk losing the original.
  Retries wait 30 seconds, then 2, 5 and 15 minutes. After five attempts the job
  fails with `video_processing_failed` or `photo_upload_failed` and its input is
  discarded, so one file cannot occupy the workers forever. A waiting retry
  goes behind other jobs so one failure does not prevent other guests' media
  from being processed.
- Startup recovers interrupted processing. A dedicated PostgreSQL advisory lock
  permits one media-worker process per application schema; CLI invitation commands
  do not start workers. Files remain on one persistent local filesystem.
  Workers are woken when a request commits work and otherwise check their queue
  every five seconds. A database error is logged and retried with a jittered
  delay of up to 30 seconds; only losing the advisory-lock connection stops the
  process, because another process may then own the queues.
- Ordinary requests have 30 seconds to arrive and 60 seconds to be answered.
  Uploads and media downloads replace those deadlines with a two-minute allowance
  plus one second per 64 KiB, enough for a 1024 MiB video on a slow connection.
  PostgreSQL connections limit statements to 30 seconds, lock waits to 10 seconds
  and idle transactions to 60 seconds.
- Thumbnails are JPEG, at most 720px on the longest side. Phone EXIF orientation is
  applied. Originals are retained unchanged, including embedded metadata, and
  remain accessible only to authenticated guests with access to their category.
- Video uploads allow MP4, MOV and WebM up to `MAX_VIDEO_SIZE_MB` MiB
  (100 by default), 5 minutes and 4K input.
  The original file is retained byte-for-byte for playback and download, including
  resolution, frame rate, codecs, audio and metadata. FFprobe validates its
  dimensions and duration; FFmpeg only creates a JPEG thumbnail. Browser playback
  depends on support for the original container and codecs. Older converted
  videos remain available, but their deleted originals cannot be restored.
  Thumbnail processing has a five-minute timeout, bounded threads and restricted input
  formats/protocols. Probe output and captured diagnostics are each capped at
  64 KiB; raw tool diagnostics are never sent to guests or written to logs.
  Each byte-range request checks the current session and category visibility.
  Input limits apply to the unchanged uploaded file. No separate playback video
  is created; only the thumbnail is resized.
- The gallery is capped at 5000 files and 10 GiB. New upload accounting includes
  photo/video originals and their thumbnails. Both share permissions, survive
  recovery and are deleted together. Lists are paginated
  at 24 items by default, maximum 48. Hosts can manage up to 500 guest identities
  and 200 programme entries. A vote offers at most 200 options, guests' write-ins
  included. These are initial explicit bounds, not performance claims.
- PostgreSQL migrations are embedded SQL files in `internal/app/migrations`,
  starting with `0001_baseline.sql`, which creates the initial schema. Later files
  change it: `0002_vote_options.sql` gives votes their options and write-ins.
  Startup validates names and checksums and applies pending files transactionally
  under an advisory lock. Add the next `NNNN_description.sql` for every schema
  change; never edit an applied migration. A database created before the baseline
  must be recreated. See [database changes](../docs/database.md).
- Guestbook posts can be anonymous. Their owner remains in PostgreSQL for deletion
  permissions, but no API response includes that identity, even for hosts.
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
Set `TEST_DATABASE_URL` to a dedicated PostgreSQL test database; integration tests
create and remove isolated schemas. Without it, database tests skip explicitly.
Root `npm run check` provisions a disposable PostgreSQL container automatically.
The pure-Go application builds and runs without cgo; the race detector itself
requires it. Tests cover invitation reuse/expiry/concurrency, session revocation,
CSRF, private reveal boundaries, upload validation, ownership and persistence.
