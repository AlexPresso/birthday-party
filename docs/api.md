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

`Guest = { id, name, role: "admin" | "guest", active: boolean, avatarUrl: string | null }`

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

## Profile photos

`Profile = { guest: Guest, limits: { imageBytes: number } }`

- `GET /api/profile` -> the signed-in guest's `Profile` and configured image limit.
- `PUT /api/profile/avatar` -> `Profile` (200). Multipart field `file`; replaces
  only the signed-in guest's photo. No guest ID is accepted from the request.
- `DELETE /api/profile/avatar` -> `Profile` (200), with `avatarUrl: null`.
- `GET /api/guests/{id}/avatar?v=<version>` -> normalized JPEG. The viewer needs
  an active session and full app access; administrators bypass the welcome gate.
  During a `profile_photo` welcome step, guests may also read their own avatar.
  A missing photo or obsolete version returns 404. HEAD is also authenticated.

Images accept JPEG, PNG and WebP, with the same `MAX_IMAGE_SIZE_MB` and
40-megapixel input limits as the gallery. Go inspects the file, applies EXIF
orientation, crops the center to a 256×256 square and encodes a JPEG without
original metadata. Originals are discarded. One profile image is processed at a
time; a busy processor returns 429 and the client retains the selection for retry.

The normalized JPEG is at most 128 KiB and stored in PostgreSQL alongside the
profile. This small bound allows atomic replacement/removal without coordinating
database commits with a file store. The version changes on replacement/removal;
all responses use `no-store`, so old image URLs cannot bypass current permissions.
While welcome access is closed, the current `profile_photo` step permits a guest
to read their own profile and save, remove or view their own photo. Other guests'
photos remain locked. An upload rechecks session, active identity and the current
welcome action before saving, so advancing to a plain step revokes that permission.

Profile photos appear beside named contributions and in the host's guest list.
An anonymous guestbook entry still returns `author: null`, including its photo.
Revoking a viewer blocks all image access; existing named contributions retain
their author's name and profile photo for other authorized viewers.

## Guest welcome

The host can close guest access while presenting an ordered welcome sequence.
New and existing guests share the same current step. Administrators retain full
access. The initial state is open; deploying this feature does not lock out guests.

`WelcomeStep = { title, body, action: "profile_photo" | "media_upload" | null, mediaUpload?: { categoryId: number | null } }`
`Welcome = { open: boolean, revision: number, step: (WelcomeStep & { position }) | null }`
`AdminWelcome = { open: boolean, revision: number, currentStep: number, steps: WelcomeStep[] }`

- `GET /api/welcome` -> `Welcome`. Only the current step is returned, never future
  steps. `step` is null during initial waiting and when the application is open.
- `GET /api/admin/welcome` -> `AdminWelcome`.
- `PUT /api/admin/welcome { revision, steps }` -> `AdminWelcome`. Up to 12 steps;
  each has a required title of 1–120 characters and an optional body of up to
  1000 characters, after trimming. An optional `action` selects the interactive
  widget: `null` for text alone, `"profile_photo"` for the guest's photo editor,
  or `"media_upload"` for sending photos and videos to the configured destination.
  Omitted actions are accepted as null for older clients; responses always include
  the field. Unknown action strings return 400 `invalid_welcome_action`.
  A media action requires `mediaUpload: { categoryId: null | positiveId }`;
  null selects the main gallery. The `categoryId` field must be present and
  reference an existing category when non-null. Other actions accept omitted or
  null `mediaUpload`, and reject non-null settings. Responses omit unused settings.
  Unknown settings and incorrect JSON types return 400 `invalid_body`; missing
  action settings or an invalid action/settings combination return 400
  `invalid_welcome_action`. An unknown category returns 404 `media_category_not_found`.
  Edit steps while open or at initial waiting;
  editing after a step is displayed returns 409 `welcome_steps_locked`.
- `POST /api/admin/welcome/transition { revision, action }` -> `AdminWelcome`.
  `start` closes an open application at `currentStep: 0`. `next` displays exactly
  one more step while closed. `open` grants full access and resets `currentStep`
  to zero. Opening is explicit, including after the last step; it can also end
  the welcome early. Invalid transitions return 409 `invalid_welcome_transition`.

Every mutation uses the last observed revision. Changes are atomic; a stale
revision returns 409 `welcome_conflict`, preventing concurrent clicks from
skipping a step or overwriting another host's changes. Steps and progress are
stored in PostgreSQL and survive restarts. Host-authored text is not translated.
Migration `0005_welcome_actions.sql` adds null actions to existing stored
steps without changing their content, order or progress. New action types need
explicit validation, permissions and presentation; arbitrary widgets cannot be
submitted by a client.
The profile-photo action has no parameters. Media-upload settings have a concrete
shape; arbitrary action configuration is not accepted.

The `profile_photo` action reuses the profile endpoints and image limits. The
guest can preview, save, replace or remove their photo on `/attente`. Saving does
not advance the welcome; only the host decides when to proceed, regardless of
whether guests have added a photo. Only the current action is sent to guests.

The `media_upload` action reuses the upload queue and image/video limits. It does
not require participation or advance the welcome. While this action is current:

- `GET /api/welcome/upload-context` returns
  `{ revision, category: MediaCategory | null, limits: { imageBytes, videoBytes } }`.
  Only the current destination's metadata is exposed, including its visibility;
  no other categories or future instructions are returned. A null category means
  the main gallery. Outside the current closed media step this endpoint returns
  423 `welcome_required`, including for administrators.
- Guests may `POST /api/photos` with `X-Welcome-Revision: <revision>`. The server
  assigns the configured destination, including a private category. An omitted
  `categoryId` query is allowed; a supplied conflicting category returns 400
  `invalid_media_category`. Missing or malformed revision returns 400 `invalid_body`.
- Guests may read their own `/api/uploads` and `/api/uploads/{id}`. All ready
  results have `photo: null` while access is closed; filenames, status and captured
  destination/revision remain available to the owner. Other owners' jobs stay private.

Upload acceptance rechecks the active session, current action, revision and
destination under database locks after reception. A stale revision returns 409
`welcome_conflict`, even if access has since opened. Retries must retain their
original revision and destination; the same upload ID cannot be retargeted.
Advancing to another media step requires new upload IDs and the new revision.

While closed, other guest requests for party details, programme, guestbook, media,
categories, thumbnails, video ranges and upload queues return 423 `welcome_required`.
Invitation acceptance, session checks, logout and welcome status remain available.
Already accepted uploads can finish privately; guests cannot read their media until
access reopens and the destination is public. A read authorized before closure may finish.

The guest page is `/attente`, outside the four-tab layout. Visible guest browsers
check welcome status every three seconds; hidden tabs pause and check again on
return. A failed check keeps the current step visible and offers retry. Opening
the application sends guests to `/photos`; closing it discards cached private
routes with a full navigation to `/attente`.
Changing steps disposes the previous widget, aborts its requests and releases
local previews. Polling an unchanged step preserves the guest's selection.

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

`Author = { id, name, avatarUrl: string | null }`
`MediaCategory = { id, name, isPublic: boolean }`
`Photo = { id, categoryId: number | null, author: Author, kind: "image" | "video", mimeType, width, height, createdAt, url, thumbnailUrl }`

The route and type names retain `photos` for compatibility; the collection
contains both photos and videos. `mimeType` is `image/jpeg`, `image/png`,
`image/webp` or `video/mp4`.

- `GET /api/media-categories` -> `{ items: MediaCategory[] }`, ordered by ID.
  Guests receive public categories; administrators receive all categories.
- `POST /api/admin/media-categories { name, isPublic }` -> `MediaCategory` (201).
- `PUT /api/admin/media-categories/{id} { name, isPublic }` -> `MediaCategory` (200).
  Both fields are required. Trimmed names contain 1–80 Unicode characters and
  `isPublic` is a boolean. There are at most 100 categories; concurrent creates
  enforce this bound. Invalid fields return 400 `invalid_media_category`, unknown
  IDs return 404 `media_category_not_found`, and capacity returns 409
  `media_category_limit`. Categories have no deletion endpoint.
- `GET /api/photos?before=<id>&limit=24&categoryId=<id>` -> `{ items: Photo[], nextCursor: string | null, limits: { imageBytes, videoBytes } }`.
  Omit `categoryId` for the main gallery (only uncategorized media). A positive
  category ID filters before pagination. Unknown or inaccessible categories return
  404 `media_category_not_found`; malformed IDs return 400 `invalid_media_category`.
- `POST /api/photos` multipart field `file` -> `UploadJob` (202). One file per request.
  Optional `X-Upload-ID` UUID makes retries idempotent for the authenticated owner.
  Optional `?categoryId=<id>` selects an accessible category; omitted means the
  main gallery. Ordinary guests cannot upload to private categories. During a
  welcome media action, the revision and destination rules above apply instead.
- `GET /api/uploads` -> `{ items: UploadJob[] }`: the owner's active jobs plus
  their 50 most recent terminal jobs. Other guests and administrators cannot read them.
- `GET /api/uploads/{id}` -> `UploadJob`, only for its owner; otherwise 404.
- `GET /api/photos/{id}/image` -> original image or normalized MP4 video;
  `?size=thumb` -> JPEG thumbnail. Video requests support authenticated byte ranges.
- `DELETE /api/photos/{id}` -> 204, only author or admin with access to its category.

Private categories are administrator-only, including for their uploaders. Every
photo read, thumbnail, HEAD, conditional/range request and deletion checks current
category visibility; inaccessible media returns 404 `photo_not_found`. Changing
visibility applies to existing files and queued results. Guest upload acknowledgments
and history keep `photo: null` for private results, without usable media URLs.
Making a category public reveals its existing contributions after full app access
opens. Main-gallery media remains visible to all guests with full access.
Migration `0006_media_categories.sql` adds nullable destinations to existing media
and jobs, keeping them in the main gallery and preserving welcome state unchanged.

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
`UploadJob = { id, clientUploadId, categoryId: number | null, welcomeRevision: number | null, status: "queued" | "processing" | "ready" | "failed", filename, kind: "image" | "video", createdAt, errorCode: string | null, photo: Photo | null }`

202 confirms the raw input and queue record have been saved. Preparation continues
after navigation, disconnection or reload. `ready` publishes the media in the
chosen gallery; `photo` is null while access is closed, the category is private,
or that media was deleted. The captured category and optional welcome revision
survive worker restarts. Failed jobs expose
a translated error code; retry by sending the file again with a fresh upload ID.
Reusing an existing upload ID returns the same job instead of adding another file,
after validating its original destination/revision and current permissions.

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
