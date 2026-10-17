# Code organization

The application has one Next.js frontend and one Go service. Go owns persistence,
authorization and business rules. Next.js renders pages and manages browser
interactions. The public contract remains in [api.md](api.md).

## Frontend

`frontend/src/app` contains routes, layouts and server rendering entry points.
It composes features and loads their initial data. Keep route files small enough
to show what the page needs.

`frontend/src/features` groups code by capability. Related components, hooks,
response schemas, inferred types and styles live together. A feature can reuse
another feature's control where the product needs it: welcome widgets use the
profile editor, media uploader and notification control.

`frontend/src/components` contains shared presentation components.
`frontend/src/lib` contains shared infrastructure such as HTTP transport,
localization and realtime connections. Shared modules do not import feature or
route code. Features do not import route modules. Keep imports explicit rather
than exporting every module through a barrel file; server-only code must stay
out of client dependency graphs.

The party layout owns the upload provider so transfers survive tab navigation.
Realtime consumers share one browser connection and refresh through authorized
HTTP requests. Keep these lifetimes when moving or composing components.
Authenticated server requests remain uncached across requests.

## Backend

The backend uses hexagonal architecture within feature packages. Each feature
keeps its models, business rules, service and required ports together. The ports
are small interfaces describing persistence or external capabilities; concrete
adapters implement them. Dependency direction follows the feature's contracts:

```text
cmd/server -> app -> feature services -> feature-owned ports
                -> concrete adapters -> feature models and ports
```

`backend/cmd/server` is the command entry point. `backend/internal/app` constructs
services and adapters, owns the database pool, registers HTTP routes, and manages
startup and shutdown. Its HTTP adapters decode requests, invoke the access and
feature services, translate errors, and serialize responses. Configuration,
database bootstrap, migrations, realtime connections and worker lifecycle remain
at this outer application boundary.

The core packages under `backend/internal` have no dependency on `app`, adapters,
SQL drivers, HTTP handlers, image libraries or FFmpeg:

| Package         | Responsibility                                                            |
| --------------- | ------------------------------------------------------------------------- |
| `access`        | Session, role and current welcome capability decisions                    |
| `identity`      | Guest validation, invitations, tokens and session policy                  |
| `programme`     | Event validation and scheduled reveal rules                               |
| `guestbook`     | Message validation, anonymous attribution and deletion rules              |
| `welcome`       | Widget validation, host transitions and guest navigation                  |
| `profile`       | Profile photo operations and current-widget access                        |
| `party`         | Party details, timezone validation and date normalization                 |
| `media`         | Gallery permissions, upload destinations and durable processing workflows |
| `notifications` | Subscription validation and durable delivery decisions                    |

The adapters provide the concrete infrastructure:

| Location                               | Responsibility                                                      |
| -------------------------------------- | ------------------------------------------------------------------- |
| `internal/adapters/postgres/<feature>` | SQL, row/advisory locks and complete atomic persistence operations  |
| `internal/adapters/avatar`             | Bounded profile image decoding and normalization                    |
| `internal/adapters/mediafiles`         | Private file storage, media inspection, image processing and FFmpeg |
| `internal/adapters/webpush`            | Web Push signing, payload serialization and delivery                |
| `internal/adapters/pushtransport`      | Restricted outbound HTTPS, DNS validation and connection limits     |

Services receive their ports through constructors and expose concrete types.
Keep domain errors independent of HTTP status codes. Time-sensitive operations
receive an explicit instant or an injected clock. Core packages may reuse another
feature's models or pure rules where the product requires it; dependencies must
remain acyclic. Keep one feature package until further separation has a concrete
benefit, rather than adding domain/application/repository subdirectories to every
feature.

### Atomic operations

Ports describe complete operations such as consuming an invitation, accepting an
upload or saving a profile photo. They do not expose `sql.DB`, `sql.Tx`, generic
queries or a transaction manager. PostgreSQL adapters acquire the required locks,
read current state, apply core rules, persist the result and commit. A callback
may apply domain policy to locked records without exposing transaction handles to
the core.

Shared checks stay within the owning mutation's transaction. Media acceptance
preserves the quota, guest, session, welcome, progress and category lock order.
Profile writes and subscription registration recheck guest/session validity and
current welcome permissions before saving. PostgreSQL adapters share the welcome
snapshot helpers and SQL predicates where they must enforce the same access rule.

The welcome adapter receives the notification adapter's enqueue callback during
composition. This adapter-to-adapter callback uses the existing transaction so a
host transition and its durable notification outbox update commit together.
Realtime invalidations are emitted only after a successful commit. No database
or network operation is added to a pure rule to make that coordination work.

Migration files remain in `backend/internal/app/migrations`. An organization
change must preserve applied SQL bytes, names and checksums. Schema changes use
new numbered migrations. Database bootstrap and the one-time SQLite import also
remain in `app`; ordinary feature SQL belongs in PostgreSQL adapters.

Core tests use in-memory ports for validation, policy and workflow failures.
Adapter tests cover processing and transport behavior. HTTP/database integration
tests in `app` exercise the composed access rules, transactions, concurrency and
public API. Run the import-boundary checks alongside behavior tests so future
changes keep dependencies pointing toward the core.

## Adding or changing a feature

1. Define its API response and permissions in Go, then align the frontend schema
   and [API documentation](api.md).
2. Put business behavior in its owning feature and persistence or external I/O in
   the corresponding adapter. Define a focused port for each required capability;
   keep multi-record authorization and persistence in one atomic operation.
3. Compose the UI from a route or settings page. Keep shared controls independent
   of their parents; place shared editing state and helpers in a feature model.
4. Test core rules without infrastructure, and preserve adapter and integration
   tests for authorization and transactions. Use frontend unit tests for pure
   models and boundary validation, and browser tests
   for interactions spanning routes, uploads or realtime updates.
5. Run the relevant checks from the root [README](../README.md#vérifier-le-projet).
   Moving files alone does not establish a runtime performance improvement.

The scoped [frontend](../frontend/AGENTS.md) and
[backend](../backend/AGENTS.md) instructions define the current implementation
rules. The repository-local skills supply supporting guidance; project rules
take precedence.
