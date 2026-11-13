# Development and deployment

The [README](../README.md) describes what the app does. This guide is for
running it, changing it and putting it online.

## How it is built

Next.js 16 and TypeScript render the interface. A single Go service owns the
rules: invitations, sessions, permissions, scheduled unlocks, the upload queue
and media processing with FFmpeg. PostgreSQL 18 stores the records and the
queue, and a private folder stores the media. The browser talks to one origin
and keeps one WebSocket open, which only carries "something changed" signals;
the data itself is always fetched through the authorised HTTP API.

- [architecture.md](architecture.md): who owns what, in the frontend and in the
  Go packages
- [api.md](api.md): the HTTP and WebSocket contract
- [design.md](design.md): the visual brief, a dark theme with one orange accent
  called “K · Neige”
- [database.md](database.md): migrations and backups
- [backend/README.md](../backend/README.md): the Go service in more detail

## Run it with Docker Compose

```sh
docker compose up -d
docker compose logs backend
```

This builds both images and starts the app with PostgreSQL. The backend log
contains a line `Administrator invitation: <url>`. Open that link, tap
**Enter**, and you are the host of an empty party at http://localhost:3000,
under a profile called `Admin`. Nothing else is created for you: no guests, no
events, no content.

Each backend start prints a fresh link for the first host and keeps their
existing sessions; set `PRINT_ADMIN_INVITATION=false` in `.env` to turn that
off. A link works once and expires after 7 days. To create another host under
their own name:

```sh
docker compose exec backend birthday-server invite-admin --name "Your name"
```

Compose only listens on `127.0.0.1:3000` and is meant for trying the app and
for development. `docker compose down` stops it; the volumes `postgres-data`
and `party-data` keep the records and the media.

## Develop

You need Node.js 24 or newer, Go 1.27.2 or newer, `ffmpeg` and `ffprobe` on the
`PATH`, and Docker for PostgreSQL.

```sh
npm ci
npm --prefix frontend ci
docker compose -p birthday-party-dev -f compose.yaml -f compose.dev.yaml up -d --wait postgres
npm run dev
```

The app is at http://localhost:3000 and the Go server on `127.0.0.1:8080`.
Next.js reloads frontend changes; restart the command after changing Go code.
Local media go to `backend/data/`, which Git ignores. To get a host link in
development, run this in a second terminal:

```sh
npm run backend -- invite-admin --name "Your name"
```

The scripts read an optional `.env` at the repository root, and
[.env.example](../.env.example) lists what it can contain. If Go is not on the
`PATH`, point `GO_BIN` at the `go` executable.

## Check your changes

```sh
# Go vet and tests, frontend lint, types and unit tests
npm run check

# Production build of the frontend
npm --prefix frontend run build

# Browser tests in Chrome (needs ffmpeg and ffprobe)
npm run test:e2e

# Formatting
npm --prefix frontend run format:check
```

`npm run check` and `npm run test:e2e` start a throwaway PostgreSQL container,
so Docker must be running, and they never touch the party's data. Stop
`npm run dev` before the browser tests or a production build, because they share
Next.js's build directory. GitHub Actions runs the same checks on every push
and pull request, and publishes the images only when they pass.

Two more checks are worth running before a release. The `go` commands run from
`backend/`:

```sh
# Known vulnerabilities in production dependencies
npm --prefix frontend audit --omit=dev
go run golang.org/x/vuln/cmd/govulncheck@latest ./...

# Race detector: needs cgo, so run it on Linux with TEST_DATABASE_URL set
go test -race ./...
```

## Deploy

Production runs on Kubernetes with the Helm chart in
[charts/birthday-party](../charts/birthday-party/README.md) (guide in French).
It installs the frontend, one Go backend and PostgreSQL, with persistent
volumes, network policies and an HTTPS Ingress that sends `/api` straight to
Go. The images are `ghcr.io/alexpresso/birthday-party-backend` and
`ghcr.io/alexpresso/birthday-party-frontend`, built for `linux/amd64` and
`linux/arm64`; deploy both with the same `sha-<full commit SHA>` tag.

Whatever sits in front of the app has a few things to get right:

- `PUBLIC_URL` must be the exact origin guests use. Invitation links are built
  from it and the server refuses WebSocket connections from any other origin.
  With an `https` URL, cookies become `Secure` on their own.
- `/api/realtime` is a WebSocket. Let the upgrade through and keep idle
  connections open for more than 30 seconds.
- Uploads need a body limit at least as large as your biggest upload limit plus
  64 KiB, and a 10-minute timeout.
- Do not cache private pages, API responses or media.
- Phone notifications only work over HTTPS. The server generates its own Web
  Push keys and keeps them in PostgreSQL, so there is no account to create with
  a push provider.

The app targets one Go process with local storage. Back up PostgreSQL and the
media folder together, with the backend stopped; [database.md](database.md) has
the procedure.

## Settings and limits

Everything about the party itself is edited in the app and stored in
PostgreSQL, with no restart. The root `.env` only carries deployment settings
such as the public URL, the database and the port. Its `BIRTHDAY_AGE`,
`INVITATION_*` and `MAX_*_SIZE_MB` values are imported once, on the first
start, and the app's own settings win from then on.

| What                | Limit                                                        |
| ------------------- | ------------------------------------------------------------ |
| Photos              | JPEG, PNG or WebP, up to 40 megapixels, 15 MiB by default    |
| Videos              | MP4, MOV or WebM, up to 5 minutes and 4K, 100 MiB by default |
| Upload size setting | 1 to 1024 MiB each for photos and videos                     |
| Gallery             | 5,000 media and 10 GiB, originals and thumbnails included    |
| Upload queue        | 100 files in progress per guest, 1,000 in total              |
| Media categories    | 100                                                          |
| Welcome             | 12 steps of up to 12 blocks                                  |
| Welcome rules       | 12 rules of 200 characters, one list per step                |
| Vote                | 2 to 200 guests, or up to 200 choices of 80 characters       |
| No Filter           | 200 questions of 1,000 characters, two jokers                |
| Invitation link     | single use, valid for 7 days                                 |
| Session             | 90 days, until sign-out or revocation                        |

Videos are stored byte for byte; the server only adds a JPEG thumbnail. Whether
a video plays in the page depends on what the guest's browser can decode, and
the download always works.

The server enforces what the interface shows. Locked events and draft
activities are held back until they are available, a private category's files
are refused to guests, and request logs leave out invitation and session
tokens. The host link printed at startup is the one exception, and you can
switch it off.

## Working with coding agents

[AGENTS.md](../AGENTS.md) and the `AGENTS.md` files in `frontend/` and
`backend/` describe the project's rules for AI coding agents. The app does not
use them: they are not part of the build or the images.

## Third-party material

Bundled third-party material keeps its own licence, included next to it:

- the Unbounded and Figtree fonts, under the SIL Open Font License 1.1
  ([frontend/public/fonts](../frontend/public/fonts));
- the interface icons, from Lucide (ISC). The app icons are an original drawing
  for this project
  ([frontend/public/icons/LICENSE.txt](../frontend/public/icons/LICENSE.txt)).
