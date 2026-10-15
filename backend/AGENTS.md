# Backend instructions

Apply [the shared instructions](../AGENTS.md) alongside these Go-specific rules.

## Go skill and architectural growth

- Read the repository's [Go Style Guide](../.agents/skills/go-style-guide/SKILL.md)
  for Go implementation, reviews, refactors and architecture decisions, then load
  only the references relevant to the task. Use this local copy even when another
  version is installed globally; its source and license are preserved alongside it.
- Project instructions take precedence over the skill's house preferences. Keep
  `cmd/server` and `internal/`; do not migrate to `pkg/`. Existing typed errors and
  application logging are appropriate here. Add config structs, sentinels and
  interfaces when they clarify a real contract, rather than for checklist compliance.
- Split functions and files around responsibilities when they become hard to follow.
  The skill's file length guidance is a review prompt, not a mandatory line limit.
- Extract a package under `internal/` when a cohesive responsibility benefits from
  its own dependencies, invariants or focused tests. Keep dependencies directional;
  avoid generic `utils` packages and speculative repository/service layers.
- Introduce a separate service only for an actual deployment, isolation or measured
  scaling need. File moves alone do not improve runtime performance. Benchmark
  optimizations before claiming gains; avoid speculative field packing or caching.

## Structure and code

- Begin with one Go service. Add packages around clear responsibilities when the code needs them.
- Prefer the standard library where it solves the problem cleanly. Choose a framework, database,
  or storage provider only when the requirements justify it.
- Use concrete types by default. Introduce small interfaces at the consuming boundary when
  substitution or a focused test needs one; avoid an interface for every struct.
- Keep handlers focused on input, access checks, calling business logic, and responses.
  Extract business logic when it has independent rules; avoid ceremonial layers for simple CRUD.
- Return and handle errors explicitly. Wrap errors with useful context and map them to consistent
  HTTP responses without exposing internal details.
- API errors expose a stable `code` and an English fallback `error`. The frontend
  translates codes into the viewer's language; Go does not negotiate language.
  Keep developer logs and CLI output in English.
- Pass request contexts through database and external calls. Configure appropriate server and
  downstream timeouts; release resources and stop work when requests are cancelled.
- Bound pagination, queries, upload sizes, and concurrent work. Avoid unbounded goroutines,
  fetching entire collections, and introducing caches or queues before they are needed.

## Access and scheduled reveals

- Go owns business rules, access control, and the authoritative unlock decision. Check access
  for each protected resource, including photo reads and writes.
- Enforce reveal times in the API and media delivery. Do not send locked content or usable media
  URLs to clients before access is allowed; hiding content in the UI is insufficient.
- For a locked event, return its public teaser as the title. With no teaser,
  return an empty title so the frontend can supply a localized placeholder.
  Preserve all authored content without automatic translation.
- Represent absolute instants in UTC. Decide the event's explicit timezone before implementing
  schedules, convert at input/output boundaries, and never depend on the server's local timezone.
- Make unlock boundary behavior explicit and test immediately before, at, and after the boundary.
  Pass a clock or time value into time-sensitive logic when useful for deterministic tests.

## Media uploads

- Validate authorization, file size, and allowed file types on the server. Inspect file contents;
  do not trust extensions or client-provided MIME types. Set limits before reading request bodies.
- Stream uploads where supported instead of buffering whole files in memory. Bound any image
  decoding or processing by dimensions and resource limits.
- Generate safe storage identifiers; never use user-provided filenames as filesystem paths.
  Keep originals private and make access to stored media follow the same resource permissions.
- Handle failed or cancelled uploads so incomplete files do not appear as successful contributions.
- Upload sizes come from MAX_IMAGE_SIZE_MB/MAX_VIDEO_SIZE_MB (15/100 MiB by
  default, integers 1–1024). Expose effective byte limits in the gallery API;
  inspect contents to choose the limit and bound the request by their maximum.
- Video inputs are MP4/MOV/WebM up to the configured size, 5 minutes and 4K. FFmpeg and
  ffprobe are runtime dependencies (included in Compose). Restrict demuxers and
  protocols, bound dimensions, threads, execution time and temporary output.
  Convert to H.264/AAC MP4 with a private JPEG thumbnail; keep range requests
  authenticated. Existing /api/photos URLs also serve videos.
- Accept uploads into a private spool and PostgreSQL job queue before processing.
  Return 202 once durable, process two jobs in the background, and recover
  interrupted jobs on restart. Only the owner may read their queue/status.
  Recheck access before publishing, bound the queue and spool, and keep processing
  independent of the request. Invitation CLI commands must not start workers.
- Distinguish invalid media from processing infrastructure failures. Retain the
  original for retry on missing tools, cancellation, storage failures or unknown
  command failures; only confirmed validation failures discard it. Preserve error
  causes without exposing private filenames or tool diagnostics. Bound probe
  output through composition so `io.Copy` cannot bypass the writer's size cap.
- Give worker startup, maintenance and lock cleanup database calls deadlines.
  Discard the dedicated lock connection if its advisory unlock cannot be confirmed;
  never return a potentially locked connection to the pool.
- Anonymous guestbook posts retain their owner only in PostgreSQL. Serialize author
  as null for all viewers, including administrators, and compute canDelete from
  the authenticated viewer. Migrations preserve existing named messages.

## Implementation and commands

- Module: `birthday-party/backend`, Go 1.26+. One standard-library HTTP service
  under `cmd/server`; concrete app/database/handlers under `internal/app`.
- PostgreSQL uses `pgx` through `database/sql`, with `$n` placeholders and
  `RETURNING` for generated IDs. Use row/advisory locks for concurrent invariants.
  `DATABASE_URL` is required; Compose supplies private connection settings.
- Schema changes belong in new sequential `internal/app/migrations/NNNN_name.sql`
  files. Embedded migrations run under a transaction and advisory lock at startup;
  applied names/checksums are verified. Never change an applied SQL file.
- `modernc.org/sqlite` is retained only for the one-time read-only import of an
  existing `DATA_DIR/birthday.sqlite`. Import into an empty destination, preserve
  IDs and sessions, reset sequences and record completion in the same transaction.
- `imaging` handles phone EXIF orientation and thumbnail resizing; `x/image/webp`
  registers WebP decoding. Do not replace content inspection with MIME/extension checks.
- Go owns the route contract in [docs/api.md](../docs/api.md). Cookie path must
  remain `/` because Next.js Server Components forward it from page requests.
- Guests see all contributions. Only author/admin can delete. Admin-only settings
  manage guests, event content and party details. Re-invitation preserves identity.
- Event timezone defaults explicitly to `Europe/Zurich` and is host-editable.
- Use private `DATA_DIR` persistence, never a frontend public directory. Full
  behavior, bounds and environment variables are in [README.md](README.md).
- Development: `go run ./cmd/server serve`.
- Initial/replacement host invitation: `go run ./cmd/server invite-admin --name "Your name"`.
- `PRINT_ADMIN_INVITATION=true` also prints an invitation at server startup; Compose
  enables it by default. Bind the listener before issuing the link. Reuse the oldest
  active administrator or create `Admin` if absent, without promoting guests,
  reactivating revoked administrators, or invalidating sessions.
- Build: `go build -o .cache/ ./cmd/server`.
- Format: `gofmt -w cmd internal`.
- Lint/static checks: `go vet ./...`.
- Type/compile check: `go build ./...`.
- Tests: `go test ./...`; race tests: `go test -race ./...` when cgo plus a supported
  C compiler are available. The application itself does not require cgo.

## Verification

- Run commands from `backend/`; export env vars explicitly (Go does not load `.env`).
- Integration tests require `TEST_DATABASE_URL` and create isolated schemas.
  Root `npm run check` starts and removes a dedicated PostgreSQL test container.
  Root `npm run test:e2e` uses another disposable database and private media folder.
- Prioritize meaningful tests of resource authorization, unlock boundaries, invalid/oversized uploads,
  and failure handling. Use table-driven tests where they improve clarity, without coverage quotas.
