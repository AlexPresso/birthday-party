# Backend instructions

Apply [the shared instructions](../AGENTS.md) alongside these Go-specific rules.

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
- Pass request contexts through database and external calls. Configure appropriate server and
  downstream timeouts; release resources and stop work when requests are cancelled.
- Bound pagination, queries, upload sizes, and concurrent work. Avoid unbounded goroutines,
  fetching entire collections, and introducing caches or queues before they are needed.

## Access and scheduled reveals

- Go owns business rules, access control, and the authoritative unlock decision. Check access
  for each protected resource, including photo reads and writes.
- Enforce reveal times in the API and media delivery. Do not send locked content or usable media
  URLs to clients before access is allowed; hiding content in the UI is insufficient.
- Represent absolute instants in UTC. Decide the event's explicit timezone before implementing
  schedules, convert at input/output boundaries, and never depend on the server's local timezone.
- Make unlock boundary behavior explicit and test immediately before, at, and after the boundary.
  Pass a clock or time value into time-sensitive logic when useful for deterministic tests.

## Photo uploads

- Validate authorization, file size, and allowed file types on the server. Inspect file contents;
  do not trust extensions or client-provided MIME types. Set limits before reading request bodies.
- Stream uploads where supported instead of buffering whole files in memory. Bound any image
  decoding or processing by dimensions and resource limits.
- Generate safe storage identifiers; never use user-provided filenames as filesystem paths.
  Keep originals private and make access to stored media follow the same resource permissions.
- Handle failed or cancelled uploads so incomplete files do not appear as successful contributions.

## Verification

- There is no Go module yet. Once scaffolded, use the actual module layout and repository commands.
- Format changed Go files with `gofmt`; run `go vet ./...` and `go test ./...` from the module root.
  Use `go test -race ./...` when changing concurrent behavior, where the toolchain supports it.
- Prioritize meaningful tests of resource authorization, unlock boundaries, invalid/oversized uploads,
  and failure handling. Use table-driven tests where they improve clarity, without coverage quotas.
