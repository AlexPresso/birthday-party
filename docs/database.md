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

## Existing SQLite installations

On startup, the backend detects `DATA_DIR/birthday.sqlite`. If no import marker
exists, it reads one consistent SQLite snapshot and copies it into an empty
PostgreSQL database in a transaction. It accepts legacy schema versions 1 and 2,
preserves guest IDs, invitation/session hashes, anonymity and media filenames,
and advances PostgreSQL identity sequences. The source file is never removed.

Stop the old backend before upgrading so it cannot write to SQLite during the
transition. Back up the complete old media volume, including SQLite/WAL files.
Then rebuild and start the new stack:

```powershell
docker compose up -d --build
```

The import marker prevents replay on later starts. If PostgreSQL already contains
application data without that marker, startup stops; resolve the two datasets
explicitly instead of merging them automatically. Restoring the old SQLite file
does not restore changes made later in PostgreSQL.

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
