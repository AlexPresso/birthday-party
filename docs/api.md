# API contract

The browser uses same-origin `/api/*`. Next.js proxies these requests to the Go
service. JSON uses camelCase. IDs are positive integers. Timestamps are RFC3339
UTC strings; optional timestamps are `null`. Errors contain a stable machine-readable
`code` and an English fallback `error`: `{ "code": "...", "error": "..." }`.
The frontend translates error codes into the viewer's language; the backend does
not negotiate locale. Names and other authored content are returned unchanged.
No automatic public signup. All routes except health and invitation preview/accept
require a valid server-side session and an active guest. Admin routes require the
admin role. State-changing requests send `X-Requested-With: birthday-party`.

## Identity

`Guest = { id, name, role: "admin" | "guest", active: boolean }`

- `GET /api/health` -> `{ status: "ok" }`.
- `GET /api/session` -> `{ guest: Guest }`, or 401.
- `POST /api/invitations/preview { token }` -> `{ guestName, expiresAt }`.
- `POST /api/invitations/accept { token }` -> `{ guest: Guest }` + HttpOnly session cookie.
- `POST /api/logout {}` -> 204 + session invalidation.

Invitation URLs use `/invitation#token=...`; a deliberate POST accepts the token,
so link previews cannot consume it. Raw tokens are returned only at issuance,
stored hashed, single use, and expire. New invitations preserve guest identity.
Invitation lifetime is 7 days; session lifetime is 90 days. The HttpOnly cookie
uses path `/` so both Next.js server rendering and API requests receive it.

## Party

`Party = { title, timezone, date: string | null, location }`

- `GET /api/party` -> `Party`.
- `PATCH /api/admin/party { title, timezone, date, location }` -> `Party`.

New database defaults: empty title, timezone `Europe/Zurich`, no date or location.
The frontend uses the configured invitation title or a localized birthday title
when the party title is empty.
Existing stored titles are preserved, including titles from earlier versions.
The host may leave the party name empty when updating the date, location or
timezone. Saving an empty `title` restores the frontend fallback; a custom title
may contain up to 120 characters and remains in the host's original language.

## Media

`Author = { id, name }`
`Photo = { id, author: Author, kind: "image" | "video", mimeType, width, height, createdAt, url, thumbnailUrl }`

The route and type names retain `photos` for compatibility; the collection
contains both photos and videos. `mimeType` is `image/jpeg`, `image/png`,
`image/webp` or `video/mp4`.

- `GET /api/photos?before=<id>&limit=24` -> `{ items: Photo[], nextCursor: string | null, limits: { imageBytes, videoBytes } }`.
- `POST /api/photos` multipart field `file` -> `UploadJob` (202). One file per request.
  Optional `X-Upload-ID` UUID makes retries idempotent for the authenticated owner.
- `GET /api/uploads` -> `{ items: UploadJob[] }`: the owner's active jobs plus
  their 50 most recent terminal jobs. Other guests and administrators cannot read them.
- `GET /api/uploads/{id}` -> `UploadJob`, only for its owner; otherwise 404.
- `GET /api/photos/{id}/image` -> original image or normalized MP4 video;
  `?size=thumb` -> JPEG thumbnail. Video requests support authenticated byte ranges.
- `DELETE /api/photos/{id}` -> 204, only author or admin.

Images accept JPEG, PNG and WebP, up to 40 megapixels decoded.
Videos accept MP4, MOV and WebM, up to 5 minutes and 4K input.
`limits` contains the effective per-file input sizes in bytes, from
`MAX_IMAGE_SIZE_MB` (default 15 MiB) and `MAX_VIDEO_SIZE_MB` (default 100 MiB).
Both accept whole MiB from 1 to 1024. The browser uses these values for selection
validation and displayed limits. Go validates file content and enforces its
corresponding limit independently of client headers.
The server inspects file contents, converts videos to H.264/AAC MP4 at up to
1280×720 and 30 fps, and generates JPEG thumbnails. Uploaded video originals
are discarded after conversion. Media and thumbnails stay authenticated.
The UI uploads a bounded queue with per-file progress and retry. Thumbnails
are at most 720 pixels per side. The gallery is capped at 5000 files and
10 GiB; new upload accounting includes the playback/original file and thumbnail.
`UploadJob = { id, clientUploadId, status: "queued" | "processing" | "ready" | "failed", filename, kind: "image" | "video", createdAt, errorCode: string | null, photo: Photo | null }`

202 confirms the raw input and queue record have been saved. Preparation continues
after navigation, disconnection or reload. `ready` publishes the media in the
gallery; `photo` can later be null if that media was deleted. Failed jobs expose
a translated error code; retry by sending the file again with a fresh upload ID.
Reusing an existing upload ID returns the same job instead of adding another file.

Two background workers prepare queued files; up to four request bodies are read
at a time independently. The durable queue allows 100 active jobs per guest,
1000 globally and 10 GiB of pending input. Capacity failures return 409
`upload_queue_full`; two busy processors alone do not reject an upload.
Terminal job history expires after 24 hours, while ready media remains in the gallery.
FFmpeg runs with limited threads, protocols, formats and processing time.
Interrupted jobs resume on server startup; failed inputs and temporary outputs
are removed, and revoked guests' jobs cannot publish media.

## Programme

`Event = { id, title, description, teaser, startsAt: string | null, unlockAt: string | null, locked: boolean }`

- `GET /api/programme` -> `{ items: Event[] }`.
- `GET /api/admin/programme` -> `{ items: Event[] }`, including unreleased content.
- `POST /api/admin/programme { title, description, teaser, startsAt, unlockAt }` -> `Event` (201).
- `PUT /api/admin/programme/{id}` same body -> `Event`.
- `DELETE /api/admin/programme/{id}` -> 204.

For guests, a locked event returns the public teaser as `title`, or an empty title
when no teaser is set, and an empty `description`. The frontend supplies a localized
surprise placeholder for an empty title. Private content must not reach the client.
An event unlocks when server time is at or after `unlockAt`. Null means available.

## Guestbook

`Entry = { id, author: Author | null, anonymous: boolean, canDelete: boolean, body, createdAt }`

- `GET /api/guestbook?before=<id>&limit=24` -> `{ items: Entry[], nextCursor: string | null }`.
- `POST /api/guestbook { body, anonymous?: boolean }` -> `Entry` (201); 1–2000 characters after trimming.
- `DELETE /api/guestbook/{id}` -> 204, only author or admin.

Omitting `anonymous` defaults to `false`. Anonymous entries return `author: null`
to every viewer, including the original author and administrators. Their owner ID
remains private in the database so the author can still delete the entry.
`canDelete` reflects the current viewer's permission: only the author or an
administrator can delete an entry. The frontend uses this flag without needing
the private identity. Existing entries keep their names after migration.

## Host controls

- `GET /api/admin/guests` -> `{ items: Guest[] }`.
- `POST /api/admin/guests { name }` -> `{ guest: Guest, invitationUrl, expiresAt }` (201).
- `POST /api/admin/guests/{id}/invitation {}` -> `{ invitationUrl, expiresAt }`.
  Replaces an unused link and reactivates a revoked guest with the same identity;
  previously revoked browser sessions remain invalid.
- `DELETE /api/admin/guests/{id}` -> 204; revoke the guest and all their sessions.
  Admins cannot revoke themselves. Existing photos/messages retain attribution.

Host access is created locally with a CLI command or at server startup when
`PRINT_ADMIN_INVITATION` is enabled (the Compose default). Startup reuses the oldest
active administrator, creating `Admin` only if none exists; it replaces that
administrator's invitation while retaining sessions. No public route creates an
administrator. Invitations are copied by the host for manual sending; the app
does not send email or WhatsApp messages.
