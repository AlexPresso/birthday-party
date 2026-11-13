# Database and migrations

PostgreSQL 18 stores application records and media jobs. Compose keeps it on its
private network and persists it in `postgres-data`. `party-data` stores private
media and queued input files. A single Go server owns media processing.

## Configuration

Set `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` in the root `.env`.
Compose forwards credentials separately, so passwords do not need URL escaping.
Use a private password for deployment. Changing these variables does not change
the credentials of an already initialized PostgreSQL volume; use PostgreSQL's
role-management commands when rotating an existing password.

Local Node launchers derive `DATABASE_URL` from those variables and
`POSTGRES_PORT` (5432 by default). Start local PostgreSQL with:

```powershell
docker compose -p birthday-party-dev -f compose.yaml -f compose.dev.yaml up -d --wait postgres
npm run dev
```

Direct Go commands require `DATABASE_URL` in the shell. The backend supports the
standard PostgreSQL `PGUSER`, `PGPASSWORD` and `PGDATABASE` environment defaults.
The separate `birthday-party-dev` Compose project keeps local development records
paired with `backend/data`, independently of the deployed application's media volume.

## Schema

`backend/internal/app/migrations/0001_baseline.sql` creates the initial schema.
It replaced the earlier migration history, so a database created before the
baseline is refused at startup ("applied migration has changed"): drop it, or its
Compose volume, and let the backend create a fresh one. Later files change the
schema in order; read them together for its current shape.

`0002_vote_options.sql` lets a vote offer guests or labels written by the host,
with optional write-ins from guests:

- `programme_votes` gains `choices` (`guests` or `custom`) and
  `allow_write_ins`. Two checks keep `allow_self_vote` for `guests` votes and
  `allow_write_ins` for `custom` ones. The `revealed` status disappears: counts
  are visible as soon as the vote is, so existing revealed votes become `closed`.
- `programme_vote_options` replaces `programme_vote_candidates`. A row is either
  a guest or a label of 1 to 80 characters, never both. `write_in` marks a label
  added by a guest. A unique index on `(activity_id, lower(label))` makes labels
  unique per vote whatever their case, so the database decides which labels are
  the same; `lower` follows the database's collation.
- `programme_ballots.option_id` replaces `candidate_id`. Its composite foreign
  key keeps a ballot on an option of its own vote and removes it with the
  option. The primary key `(activity_id, guest_id)` finds a voter's ballot; the
  index on `(activity_id, option_id)` counts the votes of each option.

Existing candidates become guest options in their saved order and every ballot
follows its candidate.

Conventions for new tables and columns:

- Flags are `BOOLEAN`; instants are `TIMESTAMPTZ`. The API renders instants as
  RFC 3339 UTC strings through `internal/timestamp`, at microsecond precision.
- Small closed sets (roles, statuses, kinds) are `TEXT` with a `CHECK`
  constraint; the Go feature package declares the matching typed constants.
- Generated identifiers use `GENERATED ALWAYS AS IDENTITY`.
- Add an index for a query that needs one; the baseline comments explain the
  non-obvious ones, such as the partial indexes of the upload queue.

## Connection settings

The backend opens every pooled connection with a 30-second `statement_timeout`,
a 10-second `lock_timeout` and a 60-second
`idle_in_transaction_session_timeout`. They bound runaway statements, lock queues
and abandoned transactions; an idle session is never affected, so the connection
holding the worker advisory lock stays open. Override a value by adding it to
`DATABASE_URL`, for example `?statement_timeout=120s`. Migrations run under the
same limits: a statement that needs longer must start with
`SET LOCAL statement_timeout = ...` in its migration file.

## Adding a schema change

1. Add the next sequential file in `backend/internal/app/migrations/`, for example
   `0003_add_media_captions.sql`. Write PostgreSQL SQL; migrations are embedded in Go.
2. Put the schema change in that file, with any necessary data backfill. Do not add
   DDL to request handlers or change an already applied migration.
3. Run `npm run check` against its disposable PostgreSQL instance. Include tests
   for meaningful changes to existing records, constraints or permissions.
4. Rebuild the backend and start it. Startup applies pending files automatically
   before serving requests. There is no separate manual migration step.

For a maintenance run without starting HTTP or media workers, use
`npm run backend -- migrate` locally or `docker compose run --rm backend migrate`.

The runner takes an advisory lock and applies pending changes in a transaction.
`schema_migrations` records each version, filename and SHA-256 checksum. Edited,
missing or unknown applied migrations stop startup. A failed migration rolls back
the transaction. SQL files must use statements that PostgreSQL permits inside a
transaction; for example, do not use `CREATE INDEX CONCURRENTLY` here.

Correct a deployed schema with a new forward migration. Automatic destructive
rollbacks are deliberately absent. Back up records and media before a release
that changes stored data.

## Consistent backups

Stop the backend while copying both PostgreSQL and the media volume. The following
PowerShell commands avoid redirecting a binary database dump through the shell:

```powershell
$backupPath = Join-Path 'artifacts/backups' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Force $backupPath
docker compose stop backend
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/birthday.dump'
docker compose cp postgres:/tmp/birthday.dump "$backupPath/birthday.dump"
docker compose cp backend:/data "$backupPath/media"
docker compose start backend
```

Store the dump and media snapshot together in private storage and test restoration
into a separate database and volume. `artifacts/` is excluded from Git.
Do not remove the Compose volumes while their records or media are still needed.

## Tests

`npm run check` creates a disposable PostgreSQL container for Go integration tests;
each test owns an isolated schema. `npm run test:e2e` creates another disposable
database and a temporary media directory. Both require Docker and clean up their
database containers on completion. Direct `go test ./...` requires
`TEST_DATABASE_URL` to run database cases; without it, those cases explicitly skip.
