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

## Photos

`Author = { id, name }`
`Photo = { id, author: Author, width, height, createdAt, url, thumbnailUrl }`

- `GET /api/photos?before=<id>&limit=24` -> `{ items: Photo[], nextCursor: string | null }`.
- `POST /api/photos` multipart field `file` -> `Photo` (201). One file per request.
- `GET /api/photos/{id}/image` -> original image; `?size=thumb` -> thumbnail.
- `DELETE /api/photos/{id}` -> 204, only author or admin.

JPEG, PNG and WebP, maximum 15 MiB each and 40 megapixels decoded. Media stays
authenticated. The UI uploads a bounded queue with per-file progress and retry.
Thumbnails are at most 720 pixels per side. The initial album is capped at 5000
photos and 10 GiB of originals. Processing accepts two concurrent uploads.

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

`Entry = { id, author: Author, body, createdAt }`

- `GET /api/guestbook?before=<id>&limit=24` -> `{ items: Entry[], nextCursor: string | null }`.
- `POST /api/guestbook { body }` -> `Entry` (201); 1–2000 characters after trimming.
- `DELETE /api/guestbook/{id}` -> 204, only author or admin.

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
