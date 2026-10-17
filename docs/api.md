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

## Realtime updates

`GET /api/realtime` upgrades to a WebSocket through the same-origin Next.js proxy.
The browser uses `ws:` locally or `wss:` over HTTPS and authenticates with its
existing HttpOnly session cookie. No token is sent in the URL. A valid session
is required, including during the welcome; the `Origin` must exactly match
`PUBLIC_URL`. Missing or foreign origins are rejected before upgrading.

The server sends these JSON messages:

```json
{ "type": "ready" }
{ "type": "invalidate", "topics": ["welcome", "uploads", "programme"] }
{ "type": "heartbeat" }
```

An invalidation contains only the changed topics, never records, media URLs,
names or authored content. The browser fetches current data from the existing
authorized HTTP endpoints. Welcome changes notify connected participants;
individual progress and upload changes target the affected guest. Programme
changes and scheduled unlocks notify viewers with full access. Signals are
coalesced and emitted after successful commits. They are not a replayable event log.

Each browser tab shares one connection across mounted consumers. `ready`
resynchronizes active views, including changes missed while disconnected.
Invalidations during an active request cause a trailing refresh so updates are
not lost. Returning to the page also resynchronizes. There is no recurring HTTP
polling fallback; failures retain the current view and existing retry controls.

The server sends heartbeats and native ping frames every 20 seconds. Heartbeats
check the connection without fetching application data. Clients reconnect with
bounded backoff after interruption. Session logout, revocation and expiry close
the connection with code `4401`; the browser returns to `/invitation` and discards
its private route cache. The client sends no application messages.

Connections and pending signals are bounded: at most 8 sockets per session and
512 per Go process. Excess connections return HTTP 429 before upgrading. Server
shutdown closes sockets and waits for their handlers. This uses the existing
single Go process; durable upload and push-notification workers remain server-side.

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
Until a guest finishes the welcome, a selected step containing a `profile_photo`
widget permits them to read their own profile and save, remove or view their own photo.
Other guests' photos remain locked. An upload rechecks session, active identity
and the current widgets before saving. Advancing to a step without a profile
widget revokes that permission.

Profile photos appear beside named contributions and in the host's guest list.
An anonymous guestbook entry still returns `author: null`, including its photo.
Revoking a viewer blocks all image access; existing named contributions retain
their author's name and profile photo for other authorized viewers.

## Guest welcome

The host unlocks an ordered welcome sequence. Waiting guests enter the first step
automatically when it becomes available. They then choose when to advance and
can revisit earlier unlocked steps. Progress is stored per guest, across
sessions and restarts. Administrators retain full access. The initial state is
open until the host explicitly starts the welcome, even when `required` is enabled.

`WelcomeWidget = { type: "title" | "text", text: string } | { type: "profile_photo" | "enable_notifications" } | { type: "media_upload", mediaUpload: { categoryId: number | null } }`
`WelcomeStep = { widgets: WelcomeWidget[] }`
`Welcome = { open: boolean, revision: number, progressRevision: number, step: (WelcomeStep & { position: number }) | null, canPrevious: boolean, canNext: boolean, canFinish: boolean }`
`AdminWelcome = { open: boolean, revision: number, currentStep: number, required: boolean, steps: WelcomeStep[] }`

- `GET /api/welcome` -> `Welcome`. Initializes the guest's progress for the current
  run if needed. `open` is this guest's effective access, rather than the host's
  global setting. Only the guest's selected step is returned, never future steps.
  `step` is null during initial waiting and once the guest has full access.
  If an incomplete current-run participant is still at position zero and at
  least one step is unlocked, this read atomically persists position one and a
  new progress revision. Repeated reads preserve both. A participant who missed
  several unlocks still enters step one, rather than skipping to the latest.
  No Start button or client progress mutation is needed for this transition.
  Render Next only when `canNext` is true.
- `POST /api/welcome/progress { revision, action }` -> `Welcome`. Use the last
  `progressRevision` as `revision`. `next` advances one unlocked step, `previous`
  goes back one step, and `finish` enters the application when `canFinish` is true.
  The first step has no previous step. Invalid movement returns 409
  `invalid_welcome_transition`; stale progress returns 409 `welcome_conflict`.
- `GET /api/admin/welcome` -> `AdminWelcome`.
- `PATCH /api/admin/welcome/required { revision, required }` -> `AdminWelcome`.
  Saves the global requirement independently of the step list. It can be changed
  during a run and does not reset guest progress or invalidate their widgets.
- `PUT /api/admin/welcome { revision, steps }` -> `AdminWelcome`. Up to 12 steps,
  each with 1–12 ordered widgets. There are no fixed title, body or action fields.
  Title widgets require 1–120 characters, and text widgets require 1–1000
  characters, after trimming. Lengths count Unicode code points. A step can repeat
  titles, texts and media upload widgets; it may contain at most one profile photo
  widget and at most one notification widget. Profile, notification and media
  widgets can coexist. A step does not need a title.
  A media upload widget requires `mediaUpload: { categoryId: null | positiveId }`;
  null selects the main gallery. The `categoryId` field must be present and
  reference an existing category when non-null. Only title/text widgets accept
  `text`, and only media upload widgets accept `mediaUpload`. Unused fields are
  rejected even when null. Widget/settings field names are case-sensitive.
  Unknown fields and incorrect JSON types return 400 `invalid_body`; unknown
  widget types, duplicate profile widgets or invalid media settings return 400
  `invalid_welcome_action`. Collection/text bounds return 400 `invalid_welcome_steps`.
  An unknown category returns 404 `media_category_not_found`. The JSON body limit
  is 1 MiB so a full bounded widget collection fits.
  Administrators can edit steps at any time, including after unlocking or opening
  access. The run, open/required settings and completed guests remain unchanged.
  Steps are positional: guests stay at their numeric position when steps are
  edited or reordered. Removing trailing steps clamps incomplete guests and the
  unlock boundary to the last remaining unlocked position (zero for no steps).
  When a run is open, all saved steps are available, including newly added ones;
  before the first run the unlock boundary remains zero. A guest's progress token
  changes only if their position or current widget types, order or destinations
  change. Text-only corrections and edits to other steps preserve active widgets.
  Affected unaccepted uploads must obtain a fresh widget context; accepted jobs
  retain their recorded revision, widget index and destination and finish normally.
  Changes reach connected guests through the shared welcome WebSocket signal.
- `POST /api/admin/welcome/transition { revision, action }` -> `AdminWelcome`.
  `start` closes an open application at `currentStep: 0` and begins a new run.
  `next` unlocks exactly one more step while closed. `open` unlocks all remaining
  steps and allows guests to finish; `currentStep` stays at the number of steps.
  Participants waiting at position zero enter step one on their next welcome
  refresh. Guests already on a step retain their position, and existing
  participants still finish explicitly to gain full access. Invalid transitions
  return 409 `invalid_welcome_transition`.

Host mutations use `AdminWelcome.revision`; guest movement uses
`Welcome.progressRevision`. Changes are atomic and revision checked, preventing
concurrent clicks from skipping steps or overwriting changes. A host unlock or
requirement change increments only the host revision. Guest movement changes
the progress revision and invalidates the previous widget context. Automatic
first-step entry also changes the progress revision once, during enrollment.
An edit that changes a guest's position or widget context also rotates their progress revision
in the same transaction; editing other steps does not interrupt that guest.

With `required: true`, a guest first joining a run starts at step one if it is
unlocked, or waits at position zero. This also applies after the host opens the
app. Finishing requires reaching the final step and the host having opened access.
With `required: false`, a new participant joins the latest unlocked step while
the welcome is closed, or enters directly after the host opens the app. Existing
participants keep their position and may finish from any step once access opens.
Completed guests keep access until a new run starts. A run with no steps can be
finished as soon as the host opens access. Widget submissions are optional;
advancing does not require saving a profile photo or uploading media.

Steps and progress are stored in PostgreSQL. Host-authored text is not translated.
Migration `0007_welcome_widgets.sql` converts each legacy step to its title widget,
nonempty body text widget and optional profile/media widget, in that order.
It preserves authored content, destinations and progress, and increments the
revision when existing steps are converted to invalidate old in-flight welcome
requests. Accepted jobs keep their destination and finish normally. Their new
`welcomeWidgetIndex` field is null; newly accepted welcome jobs always capture it.
New widget types need explicit validation, permissions and presentation.
Migration `0008_guest_welcome_progress.sql` adds the global requirement, run
generation and per-guest progress. Guests with sessions in an existing closed
welcome retain its current position. A database sequence produces progress tokens
above legacy welcome/upload revisions; already accepted uploads remain valid.

The `profile_photo` widget reuses the profile endpoints and image limits. The
guest can preview, save, replace or remove their photo on `/attente`. Saving does
not advance the welcome. The host unlocks steps independently of submissions,
and guests navigate when ready. Only the guest's selected widgets are returned.

The `media_upload` widget reuses the upload queue and image/video limits. It does
not require participation or advance the welcome. While this widget is current:

- `GET /api/welcome/upload-context?widgetIndex=N` returns
  `{ revision, widgetIndex, category: MediaCategory | null, limits: { imageBytes, videoBytes } }`.
  `revision` is the guest's stable `progressRevision`. The index is zero-based
  within their selected step's ordered widgets. A missing,
  repeated, malformed or out-of-bounds index (outside 0–11) returns 400 `invalid_body`.
  Only the selected current destination's metadata is exposed, including its visibility;
  no other categories or future instructions are returned. A null category means
  the main gallery. Outside a guest's active media step this endpoint returns
  423 `welcome_required`, including for administrators. The same response applies
  to an index that does not identify a current media upload widget.
- Guests may `POST /api/photos` with `X-Welcome-Revision: <revision>` and
  `X-Welcome-Widget-Index: <index>`. Both headers are required together. The server
  assigns the configured destination, including a private category. An omitted
  `categoryId` query is allowed; a supplied conflicting category returns 400
  `invalid_media_category`. Missing or malformed headers return 400 `invalid_body`.
- Guests may read their own `/api/uploads` and `/api/uploads/{id}`. All ready
  results have `photo: null` while that guest lacks full access; filenames, status and captured
  destination/revision/widget index remain available to the owner. Other owners' jobs stay private.

Upload acceptance rechecks the active session, selected current widget, revision and
destination under database locks after reception. Host unlocks and opening access
preserve the guest's context and any transfer in progress. A stale guest progress
revision returns 409 `welcome_conflict`, including after the guest finishes or
a new run starts. Retries must retain their
original revision, widget index and destination; the same upload ID cannot be
retargeted, even between two widgets with the same destination.
Advancing to another media step requires new upload IDs and the new revision.

Until the guest has full access, other requests for party details, programme, guestbook, media,
categories, thumbnails, video ranges and upload queues return 423 `welcome_required`.
Invitation acceptance, session checks, logout and welcome status remain available.
Already accepted uploads can finish privately; guests cannot read their media until
the guest finishes and the destination is public. A read authorized before closure may finish.

The guest page is `/attente`, outside the four-tab layout. Guest browsers refresh
welcome status on WebSocket signals, connection readiness and return to the page.
A failed check keeps the current step visible and offers retry. Finishing
sends that guest to `/photos`; starting a new run discards cached private routes
with a full navigation to `/attente`. Guest movement disposes the previous widgets,
aborts their requests and releases local previews. Host unlocks and repeated updates
preserve the current widgets and selection. Older responses cannot undo
an acknowledged guest movement.

## Notifications

The `enable_notifications` widget offers Web Push enrollment. Browser permission
is requested only after an explicit click. Declining it does not prevent guest
navigation. Settings reuse the same control to enable or disable notifications
for the current browser. A browser requires a secure context (HTTPS, with a
localhost development exception); iPhone/iPad users must open the app from the
Home Screen. The app manifest enables installation; the service worker does not
cache authenticated pages, API responses or media.

- `GET /api/notifications` -> `{ publicKey: string }`. The public VAPID key is
  URL-safe base64. No private signing material is returned.
- `POST /api/notifications/status { endpoint }` -> `{ subscribed: boolean }`.
  Checks whether this endpoint belongs to the current guest and session. It does
  not reveal another guest's registration.
- `PUT /api/notifications/subscription { endpoint, keys: { p256dh, auth }, locale }`
  -> `{ subscribed: true }`. Requires full access, an administrator, or a current
  `enable_notifications` widget. The backend rechecks access before saving.
  `locale` is one of `en`, `fr`, `de`, `it`, `es`. The browser sends its push
  subscription endpoint and URL-safe base64 key values. Enrolling an existing
  browser endpoint explicitly binds it to the current guest/session and discards
  its previous pending notification. A guest may have at most 10 subscriptions.
  Endpoints are limited to 2048 characters and public HTTPS hosts on port 443.
  Keys must decode to a valid uncompressed P-256 point and a 16-byte auth secret.
  Invalid subscriptions return 400 `invalid_notification_subscription`; exceeding
  the device limit returns 409 `notification_subscription_limit`. The JSON body
  limit is 8 KiB for saving and 4 KiB for status/removal.
- `DELETE /api/notifications/subscription { endpoint }` -> 204. Removes only the
  current guest/session's registration and its pending notification.

Configuration, status and removal require an active session but remain available
during the welcome. Browser permission alone is insufficient: the interface shows
enabled only after the subscription is stored successfully. Retries can reuse a
browser subscription after an interrupted server save.

Migration `0009` adds persistent VAPID signing keys, private session subscriptions
and a durable notification outbox. Keys are generated once and survive restarts.
`VAPID_SUBJECT` optionally sets a contact URI; HTTPS deployments default to their
configured public origin. Subscriptions are removed when the session is deleted,
and delivery rechecks session expiry and guest activity.

Host `next` and `open` transitions enqueue notifications in the same transaction
as the welcome update. This includes administrators who explicitly opt in from
settings. Delivery runs separately from the request, with one latest pending
welcome notification per subscription, at most five attempts and a 15-minute
lifetime. Expired push endpoints are removed. Payloads contain only an explicit event type
(`welcome_step` or `welcome_open`) and the selected supported locale. The service
worker displays generic translated text; it never includes names, private content,
future instructions or tokens. Clicking opens same-origin `/attente`, where the
server selects the guest's current position or redirects to their available app.
It never advances the guest automatically.

Push delivery validates HTTPS endpoints, resolves and pins public destination
addresses, and disables redirects and proxy forwarding. Endpoints and subscription
keys are private and must not appear in logs or error responses.

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
`image/webp`, `video/mp4`, `video/quicktime`, `video/webm` or `video/x-matroska`.
Video MIME types describe the original container; the existing backend Matroska
support is preserved, while the picker offers MP4, MOV and WebM.

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
- `GET /api/photos/{id}/image` -> stored original image or video;
  `?size=thumb` -> JPEG thumbnail. `?download=1` -> attachment containing the
  same file. Videos converted by earlier versions keep their existing MP4.
  The server supplies the download filename and MIME type.
  `size=thumb` takes precedence if both parameters are provided. These variants
  support authenticated HEAD and byte-range requests with the same permissions.
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
The server inspects file contents and generates JPEG thumbnails. Uploaded videos
are retained byte-for-byte for playback and download, preserving resolution,
frame rate, codecs, audio and metadata. FFmpeg only creates the thumbnail; the
video is never re-encoded or downscaled. Native browser playback depends on its
support for the original container and codecs. Previously converted videos remain
usable, but their deleted inputs cannot be recovered. Originals and thumbnails
stay authenticated, survive restart recovery and are removed together.
The UI uploads a bounded queue with one combined progress bar, a sent/total file
counter and per-file status and retry. Server acceptance counts as sent;
preparation can continue afterward. Thumbnails
are at most 720 pixels per side. The gallery is capped at 5000 files and
10 GiB; new upload accounting includes the image/video original and thumbnail.
`UploadJob = { id, clientUploadId, categoryId: number | null, welcomeRevision: number | null, welcomeWidgetIndex: number | null, status: "queued" | "processing" | "ready" | "failed", filename, kind: "image" | "video", createdAt, errorCode: string | null, photo: Photo | null }`

202 confirms the raw input and queue record have been saved. Preparation continues
after navigation, disconnection or reload. `ready` publishes the media in the
chosen gallery; `photo` is null while access is closed, the category is private,
or that media was deleted. The captured category and optional welcome revision
and widget index survive worker restarts. Failed jobs expose
a translated error code; retry by sending the file again with a fresh upload ID.
Reusing an existing upload ID returns the same job instead of adding another file,
after validating its original destination, revision, widget index and current permissions.

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
