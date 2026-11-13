# API contract

The browser uses same-origin `/api/*`. In production the Ingress sends these
requests straight to the Go service; in local development and Compose Next.js
proxies them. JSON uses camelCase. IDs are positive integers. Timestamps are RFC3339
UTC strings with at most microsecond precision; optional timestamps are `null`.
Errors contain a stable machine-readable
`code` and an English fallback `error`: `{ "code": "...", "error": "..." }`.
The frontend translates error codes into the viewer's language; the backend does
not negotiate locale. Names and other authored content are returned unchanged.
No automatic public signup. All routes except health, public configuration and invitation preview/accept
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

## Application configuration

`InvitationCopy = { title: string | null, description: string | null }`

`PublicConfiguration = { age: number, invitation: InvitationCopy & { locales: { en: InvitationCopy, fr: InvitationCopy, de: InvitationCopy, it: InvitationCopy, es: InvitationCopy } } }`

`Configuration = PublicConfiguration & { imageSizeMB: number, videoSizeMB: number }`

- `GET /api/config` -> `PublicConfiguration` (200), available without a session.
  This contains only birthday age and public invitation text. Private party
  details, upload settings, guests and deployment secrets are excluded.
- `GET /api/admin/config` -> `Configuration` (200), administrators only.
- `PUT /api/admin/config` with a complete `Configuration` -> saved `Configuration`
  (200). Rechecks active administrator and session inside the save transaction.
  Missing fields or unsupported structure return 400 `invalid_body`;
  out-of-range values return 400 `invalid_configuration`.

Age is an integer from 1 to 150. Upload sizes are integer MiB from 1 to 1024,
defaulting to 15 for images and 100 for videos. Titles accept up to 200 Unicode
codepoints and descriptions up to 2000. All five locale objects are required.
New saves enforce these text lengths; text imported from the environment is
preserved even when longer. Text is trimmed; null inherits the shared copy or translated default, while an
empty string hides the text. A locale override wins over shared copy.

Configuration is stored in PostgreSQL.
Startup imports existing age, invitation copy and upload-limit environment
values only when no configuration is saved. Later starts preserve saved values.
Changes apply on subsequent reads without restart. An incoming upload uses a
single limits snapshot; lowering a limit does not cancel previously accepted jobs.
Configuration responses use `no-store`. The frontend proxy permits 1024 MiB plus
64 KiB for multipart overhead; Go enforces the current saved file limits.

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
  The response can be revalidated; see [media caching](#media-caching).

Images accept JPEG, PNG and WebP, with the same saved image size limit and
40-megapixel input limits as the gallery. Go inspects the file, applies EXIF
orientation, crops the center to a 256×256 square and encodes a JPEG without
original metadata. Originals are discarded. The upload is received first; only
decoding is exclusive. One profile image is decoded at a time; a busy decoder
returns 429 with `Retry-After` and the client retains the selection for retry.

The normalized JPEG is at most 128 KiB and stored in PostgreSQL alongside the
profile. This small bound allows atomic replacement/removal without coordinating
database commits with a file store. The version changes on replacement/removal,
and every request, including a revalidation, checks current permissions, so old
image URLs cannot bypass them.
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

`WelcomeWidget = { type: "title" | "text", text: string } | { type: "profile_photo" | "enable_notifications" } | { type: "media_upload", mediaUpload: { categoryId: number | null } } | { type: "rules", rules: string[] }`
`WelcomeStep = { widgets: WelcomeWidget[] }`
`Welcome = { open: boolean, revision: number, progressRevision: number, step: (WelcomeStep & { position: number }) | null, canPrevious: boolean, canNext: boolean, canFinish: boolean, rulesAccepted: boolean }`
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
- `PUT /api/welcome/rules { revision, accepted }` -> `Welcome`. Use the last
  `progressRevision` as `revision`. `accepted: true` records that the guest
  ticked every rule of their current step, and `false` withdraws it. A step with
  a `rules` widget keeps `canNext` and `canFinish` false, and refuses `next`
  and `finish`, until its rules are accepted; `previous` stays available.
  `rulesAccepted` is true only when the current step has rules and this guest
  accepted them. The call is idempotent and keeps `progressRevision`, so the
  step's other widgets stay mounted. An acceptance belongs to the step's
  position in the current run: it survives edits to the rules and ends with a
  new run. A step without rules, or no current step, returns 409
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
  widget, one notification widget and one rules widget. Profile, notification,
  rules and media widgets can coexist. A step does not need a title.
  A rules widget requires `rules`: 1–12 strings of 1–200 characters after
  trimming, kept in order.
  A media upload widget requires `mediaUpload: { categoryId: null | positiveId }`;
  null selects the main gallery. The `categoryId` field must be present and
  reference an existing category when non-null. Only title/text widgets accept
  `text`, only media upload widgets accept `mediaUpload` and only rules widgets
  accept `rules`. Unused fields are
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
New widget types need explicit validation, permissions and presentation.
A database sequence produces the progress tokens. An accepted welcome upload
records both its `welcomeRevision` and `welcomeWidgetIndex`; ordinary uploads
have neither.

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

The guest page is `/attente`, outside the party layout. Guest browsers refresh
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

PostgreSQL stores the VAPID signing keys, private session subscriptions and a
durable notification outbox. Keys are generated once and survive restarts.
`VAPID_SUBJECT` optionally sets a contact URI; HTTPS deployments default to their
configured public origin. Subscriptions are removed when the session is deleted,
and delivery rechecks session expiry and guest activity.

Host `next` and `open` transitions enqueue notifications in the same transaction
as the welcome update. This includes administrators who explicitly opt in from
settings. Delivery runs separately from the request, with one latest pending
welcome notification per subscription, at most five attempts and a 15-minute
lifetime. Only a 2xx answer from the push service counts as delivered; any other
answer or a transport failure is a failed attempt, and a redirect is dropped
because redirects are never followed. Expired push endpoints (404 or 410) are
removed. The worker is woken when a transition commits and otherwise checks the
outbox every five seconds. Payloads contain only an explicit event type
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
`MediaCategory = { id, name, isPublic: boolean, coverThumbnailUrl?: string | null }`
`Photo = { id, categoryId: number | null, author: Author, kind: "image" | "video", mimeType, width, height, createdAt, url, thumbnailUrl }`

The route and type names retain `photos` for compatibility; the collection
contains both photos and videos. `mimeType` is `image/jpeg`, `image/png`,
`image/webp`, `video/mp4`, `video/quicktime`, `video/webm` or `video/x-matroska`.
Video MIME types describe the original container; the existing backend Matroska
support is preserved, while the picker offers MP4, MOV and WebM.

- `GET /api/media-categories` -> `{ items: MediaCategory[] }`, ordered by ID.
  Guests receive public categories; administrators receive all categories.
  Each item includes `coverThumbnailUrl`: the newest published photo/video
  thumbnail in that category, or `null` when none exists. Covers use authenticated
  `/api/photos/{id}/image?size=thumb` URLs with the same session, welcome and
  category permissions as gallery media. Pending uploads are never covers.
  Upload contexts and category save responses omit this optional field.
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

### Media caching

Photo, thumbnail, video and avatar responses carry `Cache-Control: private,
no-cache` and a strong `ETag`; stored photos and videos also send
`Last-Modified`. The browser may keep the bytes but must revalidate before every
reuse. A conditional request (`If-None-Match` or `If-Modified-Since`) passes the
same session, welcome and category checks as a full request and only then
receives `304 Not Modified`. A logged-out, revoked or no longer authorized
viewer gets the usual 401, 423 or 404 with `no-store` and no validator. `Range`
and `If-Range` keep working for video. The validator identifies one stored file
or one avatar image: the original and its thumbnail differ, `?download=1` shares
the original's, and a replaced avatar gets a new one. JSON responses and all
errors stay `no-store`.

Requests on these routes, and uploads, are given time in proportion to the bytes
they move (a two-minute allowance plus one second per 64 KiB), so a 1024 MiB
video survives a slow connection. All other routes keep short deadlines.

Images accept JPEG, PNG and WebP, up to 40 megapixels decoded.
Videos accept MP4, MOV and WebM, up to 5 minutes and 4K input.
`limits` contains the effective per-file input sizes in bytes from saved admin
configuration (default 15 MiB for images and 100 MiB for videos).
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
A file whose content is invalid fails at once with the matching code. A failure
unrelated to the content (storage, a missing tool, an interrupted database)
keeps the job `queued` and retries it after 30 seconds, 2, 5 and 15 minutes.
After the fifth attempt the job becomes `failed` with `video_processing_failed`
for a video or `photo_upload_failed` for an image, and its input is discarded.
Reusing an existing upload ID returns the same job instead of adding another file,
after validating its original destination, revision, widget index and current permissions.

Two background workers prepare queued files; up to four request bodies are read
at a time independently. An accepted upload wakes the workers at once; they also
check the queue every five seconds. The durable queue allows 100 active jobs per guest,
1000 globally and 10 GiB of pending input. Capacity failures return 409
`upload_queue_full`; two busy processors alone do not reject an upload.
Terminal job history expires after 24 hours, while ready media remains in the gallery.
FFmpeg runs with limited threads, protocols, formats and processing time.
Interrupted jobs resume on server startup; failed inputs and temporary outputs
are removed, and revoked guests' jobs cannot publish media.

## Programme

Activities are programme events themselves. An event has a type and optional
settings for that type; there is no nested activity collection.

`Event = { id, type: "event" | "vote" | "questions", revision, title, description, teaser, startsAt: string | null, unlockAt: string | null, locked: boolean, vote: Vote | null, questions: QuestionSummary | null }`

- `GET /api/programme` -> `{ items: Event[] }`.
- `GET /api/admin/programme` -> `{ items: Event[] }`, including drafts and locked content.
- `POST /api/admin/programme { type, title, description, teaser, startsAt, unlockAt, vote? }` -> `Event` (201).
- `PUT /api/admin/programme/{id}` accepts the same body plus `revision` for interactive events -> `Event`.
- `DELETE /api/admin/programme/{id}` -> 204, including its votes, questions and upvotes.

A missing type creates an ordinary `event`; omitting type on update preserves
its existing type. Types cannot change after creation. Ordinary events have
`vote: null` and `revision: 1`. Creating a vote requires the `vote` settings
described under [Vote events](#vote-events). Event metadata, vote settings and
options are saved in one transaction. Invalid settings leave no partial event.
The programme is limited to 200 events across all types.

For guests, a locked published event returns the public teaser as `title`, or an
empty title when no teaser is set, an empty `description`, `vote: null` and `questions: null`.
The frontend supplies a localized surprise placeholder for an empty title.
An event unlocks when server time is at or after `unlockAt`; null means available.
Draft interactive events are omitted entirely from the guest programme, including their
metadata. The visibility decision uses one instant for the complete response.

### Question events (No Filter)

Create with `type: "questions"` and ordinary event metadata; no additional settings
are required. This creates a draft round atomically. Questions are anonymous to
all viewers, including administrators. The database retains the submitting guest
for access/accounting, but no author name, ID, avatar or voter list is returned.

```typescript
type QuestionSummary = {
  status: "draft" | "open" | "closed";
  jokersUsed: number; // 0 to 2, shared by the whole activity
  questionCount: number; // 0 to 200
};
type QuestionRound = QuestionSummary & {
  revision: number;
  items: {
    id: number;
    body: string;
    status: "pending" | "answered" | "joker";
    votes: number;
    upvoted: boolean; // Only the current viewer's vote
  }[];
};
```

- `GET /api/programme/{id}/questions` -> `QuestionRound`.
- `POST /api/programme/{id}/questions { body }` -> `QuestionRound` (201).
- `PUT /api/programme/{id}/questions/upvote { questionId, upvoted }` -> `QuestionRound`.
- `POST /api/admin/programme/{id}/questions/state { status, revision }` -> `QuestionRound`.
- `PUT /api/admin/programme/{id}/questions/resolve { questionId, status, revision }` -> `QuestionRound`.

Questions contain 1–1,000 Unicode characters after trimming; each activity accepts
at most 200. Guests need full app access, an unlocked event and an open round to
submit or vote. Each guest may upvote any pending question once, including their
own; setting `upvoted` is idempotent and false removes it. Counts are visible
immediately. Pending questions come first, ordered by descending votes, then ID.

Host transitions are `draft` -> `open` -> `closed`. Closing stops submissions and
votes but still allows answers. The host answers orally and marks a pending
question `answered`, or spends a joker to mark it `joker`. These are terminal
states. The whole activity has exactly two jokers, enforced under transaction
locks and a database constraint. Concurrent actions cannot overspend. Host edits,
transitions and resolutions increment the revision; submissions and upvotes do
not. Metadata edits preserve all questions, votes and spent jokers.

Reads and mutations recheck current session, guest and welcome access in their
transaction. Locked/draft rounds return 404 to guests. Successful mutations emit
the shared programme invalidation after commit. Errors include `invalid_question`
(400), `questions_closed`, `question_limit_reached`, `no_jokers_left` and
`activity_conflict` (409). Private content never travels in WebSocket messages.

### Vote events

Add future event types explicitly with their own validation, authorization,
settings editor and renderer. The first interactive type is `vote`:

```typescript
type Vote = {
  question: string;
  status: "draft" | "open" | "closed";
  choices: "guests" | "custom";
  allowSelfVote: boolean; // meaningful for "guests" only; false otherwise
  allowWriteIns: boolean; // meaningful for "custom" only; false otherwise
  options: VoteOption[]; // votes descending, then label (case-insensitive), then id
  myOptionId: number | null; // the viewer's own choice only
  canVote: boolean;
};

type VoteOption = {
  id: number; // stable option id
  label: string; // guest name or the custom text, unchanged
  guestId: number | null; // set for "guests" options
  avatarUrl: string | null; // authenticated avatar URL for guest options
  active: boolean; // false for a revoked guest; custom options are always true
  writeIn: boolean; // created by a guest
  votes: number; // live count, visible to everyone who sees the vote
};
```

The options of a vote come from one source, chosen when the vote is created:
`guests` offers active guests picked by the host, `custom` offers labels typed
by the host. A `custom` vote may also let guests add a choice (`allowWriteIns`).

Create and edit (`POST /api/admin/programme`, `PUT /api/admin/programme/{id}`)
take these `vote` settings:

```typescript
vote: {
  question: string; // 1–240 characters after trimming
  choices: "guests" | "custom";
  candidateIds?: number[]; // "guests": 2–200 distinct active guests
  labels?: string[]; // "custom": 0–200 distinct labels, 1–80 characters after trimming
  allowSelfVote: boolean; // must be false for "custom"
  allowWriteIns: boolean; // must be false for "guests"
}
```

A `custom` vote needs at least 2 labels, or `allowWriteIns: true`; it may then
start with one label or none. Labels are stored trimmed, as typed. They are
compared case-insensitively after trimming, and duplicates are rejected.
`candidateIds` belongs to `guests` and `labels` to `custom`; sending the other
list non-empty is invalid. Invalid settings return `invalid_activity`, a label
of the wrong length `invalid_vote_label`, and an unknown or revoked candidate
`invalid_vote_option`.

`choices`, the option list, `allowSelfVote` and `allowWriteIns` can change only
while the vote is a draft; the question and event metadata stay editable. Once
the vote is open, an edit must repeat the same settings: the same candidates in
any order, or every label of the host. Labels of current write-ins may be
included and are ignored; anything else returns `activity_conflict`. Saving a
draft replaces its options, so option IDs are stable from the opening onwards.

The current revision is required for every edit to an existing vote event,
including metadata-only updates with an omitted type or vote. Omitting vote on
such an update preserves its settings. Host edits and transitions increment the
revision; guest votes, write-ins and the removal of a write-in do not. Stale
edits fail without changing metadata, settings or ballots.

- `POST /api/admin/programme/{id}/vote/state { status: "open" | "closed", revision }` -> `Event`.
  Transitions are `draft` -> `open` -> `closed`. Opening a `guests` vote needs
  at least 2 active candidates (`invalid_vote_option` otherwise).
- `PUT /api/programme/{id}/vote { optionId }` -> `Event`. Votes for an existing
  option.
- `POST /api/programme/{id}/vote/options { label }` -> `Event` (200). Write-in:
  only for an open `custom` vote with `allowWriteIns`. The label has 1–80
  characters after trimming. If an option already carries it, whatever the case,
  the viewer's vote goes to that option; otherwise the option is created with
  the spelling typed and receives the vote. Both happen in one transaction, so
  two guests typing the same new label create one option with two votes. A vote
  has at most 200 options, write-ins included.
- `DELETE /api/admin/programme/{id}/vote/options/{optionId}` -> `Event`. Removes
  a write-in option and its votes, while the vote is open or closed. An option
  of the host returns `activity_conflict`; an option that is unknown or belongs
  to another vote returns `invalid_vote_option`.

Each guest has one stored choice per vote event and can replace it while voting
is open, with either route. The server derives the voter from the current
session and atomically checks access, event availability, vote state and option
eligibility before saving. Nobody can vote for the option of a revoked guest,
which stays listed with `active: false` and the votes it received. A guest
cannot vote for their own option unless `allowSelfVote` is set. A write-in
option that loses its last vote disappears in the same transaction; options of
the host stay, even without votes.

Every viewer who can see the vote receives all its options with their live
counts, while it is open and after it closes; the total is the sum of
`options[].votes`. Administrators receive the same `Vote` as guests, on both
programme endpoints, plus drafts on the admin one. Responses never contain other
voters' identities or individual choices; `myOptionId` is only the viewer's own
choice, and `guestId` names the guest an option stands for, never a voter.
`canVote` is true while the vote is open and offers the viewer an eligible
option or accepts write-ins. PostgreSQL retains voter IDs to enforce uniqueness
and allow replacing a vote.

Draft votes are omitted from the guest programme and a locked event hides its
vote entirely; both return 404 to a guest who tries to vote. Changes publish the
shared `programme` invalidation after commit. Clients refresh through authorized
HTTP requests without polling. These events require full app access and do not
grant access during the welcome sequence.

A database constraint prevents multiple activity records belonging to one event.

Vote errors, alongside existing event, access and not-found errors:

| Code                  | Status | Meaning                                                                |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `invalid_activity`    | 400    | Invalid question, source, option count, duplicate or flag combination  |
| `invalid_vote_label`  | 400    | A label or write-in without 1–80 characters after trimming             |
| `invalid_vote_option` | 400    | Unknown, inactive or foreign option                                    |
| `self_vote_forbidden` | 400    | The viewer's own option while self-votes are off                       |
| `write_ins_disabled`  | 403    | Write-in on a `guests` vote or a `custom` vote that does not allow it  |
| `vote_closed`         | 409    | Vote or write-in after the vote closed                                 |
| `vote_option_limit`   | 409    | A new write-in when the vote already has 200 options                   |
| `activity_conflict`   | 409    | Stale revision, frozen setting, bad transition, removing a host option |

## Information page

The host writes one page of titled texts and decides when guests see it.

`InformationTab = { title: string, body: string }`
`Information = { enabled: boolean, tabs: InformationTab[] }`
`AdminInformation = { enabled: boolean, revision: number, tabs: InformationTab[] }`

- `GET /api/information` -> `Information`. Needs full app access, so it answers
  423 `welcome_required` during the welcome sequence. `enabled` is true only
  when the host turned the page on and it has at least one tab; otherwise
  `tabs` is always empty, so a page that is off gives nothing away.
- `GET /api/admin/information` -> `AdminInformation`, administrators only.
  `enabled` is the host's switch as saved, even without a tab.
- `PUT /api/admin/information { revision, enabled, tabs }` -> `AdminInformation`
  with the next revision. Send the last `revision` received; a stale one
  returns 409 `information_conflict` and changes nothing. Up to 8 tabs, kept in
  order. A title has 1–40 characters and a text 1–4,000 after trimming, counted
  in Unicode code points; anything else returns 400 `invalid_information`.
  Missing fields, unknown fields and wrong types return 400 `invalid_body`.
  The JSON body limit is 256 KiB so the largest page fits.

Texts are authored content: stored as written, never translated, and plain.
The interface keeps their line breaks and turns web addresses, e-mail addresses
and phone numbers into links; nothing else is interpreted. Changes are not
signalled over the WebSocket: the interface reads the page when it renders.

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
the private identity.

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
