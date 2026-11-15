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
After 120 failed previews or acceptances in a minute, across all clients, both
routes return 429 `too_many_attempts` with `Retry-After` until the minute ends.
Successful ones never count, so guests opening their links together are not held.

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
coalesced and emitted after successful commits; a socket receives at most one
invalidation per second, carrying every topic changed meanwhile. They are not a
replayable event log.

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

`Appearance = { theme: "dark" | "light", accent: string }`

`PublicConfiguration = { age: number, invitation: InvitationCopy & { locales: { en: InvitationCopy, fr: InvitationCopy, de: InvitationCopy, it: InvitationCopy, es: InvitationCopy } }, appearance: Appearance }`

`Configuration = PublicConfiguration & { imageSizeMB: number, videoSizeMB: number, whatsappMessage: string | null }`

`whatsappMessage` is the text the host sends with each invitation on WhatsApp, up
to 1,000 characters, where the interface replaces `{name}` and `{link}`. Null,
or a blank text, uses the interface message in the host language. It is never
part of `PublicConfiguration`.

- `GET /api/config` -> `PublicConfiguration` (200), available without a session.
  This contains only birthday age, public invitation text and the appearance
  the invitation page needs. Private party details, upload settings, guests and
  deployment secrets are excluded.
- `GET /api/admin/config` -> `Configuration` (200), administrators only.
- The appearance is the host's choice of theme and main colour for the whole
  app. `accent` is `#` and six hexadecimal digits, saved in lower case; an
  unknown theme or another colour format returns 400 `invalid_configuration`.
  The defaults, dark and `#ff6a1f`, are the look the app was designed with.
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
original metadata. Originals are discarded. The upload is received first, then
waits for decode memory shared with gallery processing: ordinary phone photos
decode side by side, very large ones take turns. After 20 seconds of waiting it
returns 429 `profile_photo_busy` with `Retry-After`, and the client retains
the selection for retry.

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

### Programme notifications

While the host's switch is on, subscribed devices are told when an event starts
and when a scheduled reveal is reached. Opening a vote or a question round
sends nothing. A worker advances one cursor under a row lock and queues what
became due since its last pass, so each moment is announced once, even after a
restart; a moment more than 15 minutes old is dropped, and moving an event to a
later time announces it again then. The cursor also advances while the switch
is off, so turning it on announces nothing from the past.

- An event whose start and reveal are due together sends one notification, for
  the start.
- A vote still in draft sends nothing. Question and werewolf events have no
  draft: their start and reveal are announced like an ordinary event's.
- Recipients are devices of administrators and of guests with full app access
  at that moment; guests held in the welcome sequence receive nothing.
- Each device keeps one queued message per event and moment, with the same
  attempts, lifetime and removal rules as welcome notifications.

The payload is `{ type: "programme_start" | "programme_unlock", locale, title,
eventId }`. `title` is the event's name as the programme shows it to guests at
that moment: the title once unlocked, the teaser while locked, or an empty
string for a locked event without a teaser, which the service worker replaces
with its translated surprise wording. This is the only host-written text a
push payload may carry: descriptions, venues, names, media and tokens never
travel. The service worker shows the name with a short translated line, and a
click opens same-origin `/programme`.

### Storage alerts

Administrators' subscribed devices are told when the media disk becomes more
than 80% full, once per crossing: the alert comes again only after usage has
dropped below 75%. They are also told when files are refused for lack of room,
at most once an hour. The worker checks the disk after each accepted upload and
every minute, since anything on the disk may fill it. The payload is
`{ type: "storage_warning" | "storage_full", locale }`, without content; it
stays deliverable for 12 hours, and a click opens `/parametres?section=storage`.

Push delivery validates HTTPS endpoints, resolves and pins public destination
addresses, and disables redirects and proxy forwarding. Endpoints and subscription
keys are private and must not appear in logs or error responses.

## Storage

The disk holding `DATA_DIR` bounds the gallery, not a fixed quota. Before reading
an upload's body, Go compares the space left on that disk with what the upload
and every reception in progress may still write (their announced size, or the
size limit). The upload must leave twice the largest configured photo or video
size plus 512 MiB free, so both workers can copy an original into the gallery
while publishing it, and 5% of the disk, up to 10 GiB, for whatever else lives
on it: with Docker Compose, PostgreSQL shares that disk and must not be starved
by uploads. Otherwise it returns 409 `storage_full` before the file is sent. Profile photos are never stored on disk and are not refused this way.

- `GET /api/admin/storage` -> `{ totalBytes, availableBytes, warning }`,
  administrators only. `warning` is true from 80% used. Settings show it as a
  bar under Photos and videos.

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
`Photo = { id, categoryId: number | null, author: Author | null, kind: "image" | "video", mimeType, width, height, createdAt, url, thumbnailUrl }`

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
are at most 720 pixels per side. The gallery is capped at 5000 files. Its size
is bounded by the disk itself; see [storage](#storage).
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

Two background workers prepare queued files. Request bodies are read two at a
time per guest and 24 at a time overall; further uploads wait for a place, so
a slow connection only delays its own guest. An accepted upload wakes the
workers at once; they also check the queue every five seconds. The durable
queue allows 100 active jobs per guest and 1000 globally. Capacity failures
return 409 `upload_queue_full`; two busy processors alone do not reject an
upload. Queued and processing files count toward the gallery limit, so a full
gallery returns 409 `album_full` before the file is sent rather than after its
preparation.
Terminal job history expires after 24 hours, while ready media remains in the gallery.
FFmpeg runs with limited threads, protocols, formats and processing time.
Interrupted jobs resume on server startup; failed inputs and temporary outputs
are removed, and revoked guests' jobs cannot publish media.

## Programme

Activities are programme events themselves. An event has a type and optional
settings for that type; there is no nested activity collection.

`Event = { id, type: "event" | "vote" | "questions" | "werewolf", revision, title, description, teaser, startsAt: string | null, unlockAt: string | null, locked: boolean, vote: Vote | null, questions: QuestionSummary | null, werewolf: WerewolfSummary | null }`

- `GET /api/programme` -> `{ items: Event[] }`, gzip-compressed when the client accepts it.
  Every open screen refetches it after any change, so each vote carries only
  its three leading options there, with `myOptionId: null`; `canVote` still
  tells whether the guest can vote.
- `GET /api/programme/{id}` -> `Event` with the whole vote: every option, the
  viewer's choice and `canVote`. Administrators get the host's view, drafts
  and locked details included; for a guest a draft is 404 and a locked event
  has no activity details.
- `GET /api/admin/programme` -> `{ items: Event[] }`, including drafts and locked content and whole votes.
- `POST /api/admin/programme { type, title, description, teaser, startsAt, unlockAt, vote?, werewolf? }` -> `Event` (201).
- `PUT /api/admin/programme/{id}` accepts the same body plus `revision` for vote and question events -> `Event`.
- `DELETE /api/admin/programme/{id}` -> 204, including its votes, questions, upvotes and werewolf game.
- `GET /api/admin/programme/notifications` -> `{ enabled: boolean }`, administrators only.
- `PUT /api/admin/programme/notifications { enabled }` -> `{ enabled }`. One switch
  for every programme notification, on by default. No revision: the last write
  wins. A missing or non-boolean `enabled` returns 400 `invalid_body`.

A missing type creates an ordinary `event`; omitting type on update preserves
its existing type. Types cannot change after creation. Ordinary events have
`vote: null` and `revision: 1`. Creating a vote requires the `vote` settings
described under [Vote events](#vote-events); a werewolf event takes the
`werewolf` settings described under [Werewolf events](#werewolf-events-loup-garou).
Settings that do not belong to the event's type are refused (`invalid_event`,
or `activity_conflict` when an update omits or changes the type). Event
metadata, settings and options
are saved in one transaction. Invalid settings leave no partial event.
The programme is limited to 200 events across all types.

For guests, a locked published event returns the public teaser as `title`, or an
empty title when no teaser is set, an empty `description`, `vote: null`,
`questions: null` and `werewolf: null`.
The frontend supplies a localized surprise placeholder for an empty title.
An event unlocks when server time is at or after `unlockAt`; null means available.
Draft interactive events are omitted entirely from the guest programme, including their
metadata. The visibility decision uses one instant for the complete response.

### Question events (No Filter)

Create with `type: "questions"` and ordinary event metadata; no additional settings
are required. This creates an open round atomically: guests may ask and upvote
as soon as the event is revealed to them, without any step from the host. Questions are anonymous to
all viewers, including administrators. The database retains the submitting guest
for access/accounting, but no author name, ID, avatar or voter list is returned.

```typescript
type QuestionSummary = {
  status: "open" | "closed";
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

The only host transition is `open` -> `closed`; a closed round does not
reopen. Closing stops submissions and votes but still allows answers. The host answers orally and marks a pending
question `answered`, or spends a joker to mark it `joker`. These are terminal
states. The whole activity has exactly two jokers, enforced under transaction
locks and a database constraint. Concurrent actions cannot overspend. Host edits,
transitions and resolutions increment the revision; submissions and upvotes do
not. Metadata edits preserve all questions, votes and spent jokers.

Reads and mutations recheck current session, guest and welcome access in their
transaction. Locked rounds return 404 to guests. Successful mutations emit
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

### Werewolf events (Loup-garou)

A companion for the hidden-role party game played aloud. The app deals one
secret role to each player and keeps the board; turns, votes and nights are
played aloud. A werewolf event has no draft: its game is visible as soon as the
event is.

```typescript
type Person = { id: number; name: string; avatarUrl: string | null };

// On Event, for every viewer who can see the event's content.
type WerewolfSummary = {
  status: "lobby" | "running" | "finished";
  gameMaster: Person | null;
  players: number; // how many joined
};

// The game, as one viewer sees it.
type Werewolf = {
  status: "lobby" | "running" | "finished";
  revision: number; // see "Revision" below
  gameMaster: Person | null;
  isGameMaster: boolean;
  joined: boolean; // the viewer is a player
  hideRolesOfDead: boolean; // variant "secret deaths"
  ghostMessages: boolean; // variant "ghost messages"
  phase: "day" | "night"; // "night" only once started
  players: Player[]; // join order; while running, a non-master viewer gets their own seat and the dead only
  myRole: RoleCard | null; // the viewer's own role, when running or finished
  canWriteMessage: boolean; // viewer is a dead player, night, variant on, game running
  myMessage: string | null; // what the viewer wrote, while the game runs with the variant
  mayorMessage: { from: Person; text: string } | null; // only for the current mayor, by day
  // Game master only; null for everyone else, the party's host included.
  roles: Role[] | null;
  messages: { from: Person; text: string; delivered: boolean }[] | null; // join order of the writers
};

type Player = Person & {
  alive: boolean;
  mayor: boolean;
  role: RoleCard | null; // null whenever this viewer may not see it
};

// A built-in role has a key and name: null; the interface translates its name
// and, while description is null, its explanation. A custom role has key: null
// and its own name. description is null when nothing was written.
type RoleCard = {
  key: string | null;
  name: string | null;
  description: string | null;
};
type Role = RoleCard & { id: number; count: number };
```

Built-in keys: `werewolf`, `villager`, `seer`, `witch`, `hunter`, `cupid`,
`guard`. A new game lists all seven in that order, `werewolf` at 1 and the
others at 0.

#### Event settings

Create and edit (`POST /api/admin/programme`, `PUT /api/admin/programme/{id}`)
take `type: "werewolf"` and `werewolf: { gameMasterId: number | null }`: the
guest who leads the game, or null while undecided. The host chooses any active
guest, themselves included. On creation, omitting `werewolf` means no game
master; on update, omitting it keeps the current one.

- An unknown or revoked guest returns 400 `invalid_vote_option`; a
  `gameMasterId` that is not a positive number returns 400 `invalid_event`.
- While the game is `running`, naming another game master, or none, returns
  409 `activity_conflict`. Repeating the current one is accepted.
- A player who becomes game master stops being a player.
- A werewolf event needs no `revision` to be edited; a value sent is ignored.
  Renaming or rescheduling the event keeps the game, its players and its roles.

#### Who sees what

Go builds each response for its viewer; no response carries the full state.

- The game master: every player's role, the role list with its quantities and
  every ghost message with its `delivered` flag.
- A player: their own role once the game runs, as `myRole` and on their own
  entry of `players`.
- Everyone who can open the game: in the lobby and once `finished`, every
  player's name, photo, `alive` and `mayor`, and every role once
  `finished`. While the game runs, a viewer who is not the game master gets
  only their own seat (with `alive` and `mayor`) and the dead players, with a
  dead player's role unless `hideRolesOfDead` is on. Who is still alive and
  who is mayor are said aloud.
- The party's host has no special view: they see what a game master, a player
  or a guest who did not join sees, whichever they are.
- Ghost messages: a ghost sees their own (`myMessage`) and the current mayor,
  by day, the one that was drawn (`mayorMessage`, with its writer but never
  the writer's role). Both are null unless the game is running with the
  variant on. A mayor named after the draw reads the drawn message; a former
  mayor no longer does. The game master's `messages` stay until the next
  night, the variant is turned off or the game is reset.

#### Routes

All routes need full app access (423 `welcome_required` otherwise) and an
unlocked event. An unknown event, an event of another type and a locked event
return 404 `not_found`, for administrators and the game master too: before the
unlock, the game only appears as the summary of `GET /api/admin/programme`.
Every route returns the viewer's `Werewolf` with status 200.

- `GET /api/programme/{id}/werewolf`.
- `POST /api/programme/{id}/werewolf/players {}`. The viewer joins. Lobby only
  and not the game master (409 `activity_conflict`); joining twice changes
  nothing. 409 `werewolf_player_limit` at 60 players.
- `DELETE /api/programme/{id}/werewolf/players/me`. The viewer leaves. Lobby
  only (409 `activity_conflict`); leaving twice changes nothing.

Game master only: anyone else, the party's host included, gets 403
`game_master_required`, as does everyone while the game has no game master.
A command in the wrong state returns 409 `activity_conflict`, and so does a
stale `revision` on the two commands that carry one.

- `PUT /api/programme/{id}/werewolf/roles { revision, roles: RoleInput[] }`.
  Lobby only. `RoleInput = { id?: number, key: string | null, name: string |
null, description: string | null, count: number }`. The list replaces the
  saved one, in its order: a role sent with the `id` of a current role keeps
  that ID, a role without `id` is added and roles left out are removed. An
  `id` must belong to this game and keep its kind (the same built-in key, or
  custom). 1–20 roles; built-in keys known and unique; `villager` present;
  built-in roles carry `name: null`; custom roles need a name of 1–40
  characters; `description` up to 600 characters, an empty one is saved as
  null; `count` 0–60. Names and descriptions are trimmed and lengths count
  Unicode code points. 400 `invalid_werewolf_roles` otherwise.
- `PUT /api/programme/{id}/werewolf/variants { hideRolesOfDead, ghostMessages }`.
  Any state; both booleans are required (400 `invalid_body`). Turning ghost
  messages off deletes the messages; the phase stays as it is.
- `POST /api/programme/{id}/werewolf/state { revision, action }`.
  `start` (lobby -> running) needs at least 3 players and quantities that add
  up to the number of players, 409 `werewolf_roles_mismatch` otherwise; it
  deals the roles at random in the same transaction. `finish` (running ->
  finished). `reset` (finished -> lobby) keeps the players, roles and variants
  and clears the dealt roles, deaths, mayor, messages and phase. An unknown
  action returns 409 `activity_conflict`.
- `DELETE /api/programme/{id}/werewolf/players/{guestId}`. Lobby only: removes
  a player. Removing someone who is not a player changes nothing.
- `PUT /api/programme/{id}/werewolf/players/{guestId} { alive }`. Running
  only. 400 `invalid_werewolf_player` for someone who is not a player. A mayor
  who dies stops being mayor. Bringing a player back deletes the message they
  wrote as a ghost.
- `PUT /api/programme/{id}/werewolf/mayor { guestId: number | null }`. Running
  only. Null, or an omitted `guestId`, names nobody. 400
  `invalid_werewolf_player` for someone who is not a player, 409
  `activity_conflict` for a dead player.
- `PUT /api/programme/{id}/werewolf/phase { phase: "day" | "night" }`. Running
  only, in every game: every viewer sees the phase. With ghost messages on,
  `night` -> `day` draws one of the night's
  messages, each equally likely, and marks it delivered if the game has a
  mayor at that moment; without a mayor nothing is delivered. `day` -> `night`
  deletes the messages. Sending the current phase changes neither the phase
  nor the messages. Another value returns 409 `activity_conflict`.

Ghosts only:

- `PUT /api/programme/{id}/werewolf/message { text }`. The viewer must be a
  dead player, by night, with the variant on and the game running: 403
  `werewolf_message_forbidden` otherwise. The text is trimmed; one message per
  ghost and night, replaced by the next one; an empty text removes it; 400
  `invalid_werewolf_message` over 280 characters.

Role and message validation (400) runs before the game is read, so it also
answers a viewer who would otherwise get 403 or 409.

#### Revision

`revision` is the event's revision. Every accepted game master command
increments it, as does the host's edit of the event; joining, leaving and
ghost messages do not. Only `roles` and `state` check it.

Each command runs in one transaction that rechecks the viewer's session, guest
and welcome access, holds the event and locks the game, so commands on one
game are serialized. The deal and the draw use `crypto/rand`. Successful
changes publish the shared `programme` invalidation after commit and clients
fetch their own view; roles, quantities and messages never travel over the
WebSocket. Deleting the event deletes the game.

Werewolf errors, alongside existing event, access and not-found errors:

| Code                         | Status | Meaning                                                                    |
| ---------------------------- | ------ | -------------------------------------------------------------------------- |
| `game_master_required`       | 403    | A game master command from anyone else                                     |
| `invalid_werewolf_roles`     | 400    | Role list outside the limits, without `villager`, or with a foreign `id`   |
| `invalid_werewolf_player`    | 400    | Life or mayor command for someone who is not a player                      |
| `invalid_werewolf_message`   | 400    | Ghost message over 280 characters                                          |
| `werewolf_message_forbidden` | 403    | Message from someone who is not a ghost, by day or without the variant     |
| `werewolf_roles_mismatch`    | 409    | Start with fewer than 3 players or quantities that differ from the players |
| `werewolf_player_limit`      | 409    | Join when the game already has 60 players                                  |
| `activity_conflict`          | 409    | Wrong state, stale revision, dead mayor, game master change while running  |

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

`Entry = { id, author: Author | null, anonymous: boolean, canDelete: boolean, body, voice: Voice | null, createdAt }`

`Voice = { url: "/api/guestbook/{id}/voice", durationMs, peaks: number[48] }`

- `GET /api/guestbook?before=<id>&limit=24` -> `{ items: Entry[], nextCursor: string | null }`.
- `POST /api/guestbook { body, anonymous?: boolean }` -> `Entry` (201); 1–2000 characters after trimming.
- `POST /api/guestbook` as `multipart/form-data`, a `body` field (0–2000 characters)
  then an `audio` file -> `Entry` (201). A voice note is always signed.
- `GET /api/guestbook/{id}/voice` -> `audio/mp4` with ranges, for guests with full access.
- `DELETE /api/guestbook/{id}` -> 204, only author or admin; its voice note goes with it.

A recording is a WebM, Ogg or MP4 file of at most 16 MiB and five minutes,
recognized from its content. Go re-encodes it with FFmpeg as mono AAC in MP4,
which every browser plays, and measures its length and waveform (`peaks`, 48
levels from 0 to 255) from the decoded audio. The entry and its recording are
stored together in PostgreSQL. Unreadable or longer audio fails with
`invalid_voice_note`, a larger file with `voice_note_too_large` (413). The
audio has a strong `ETag` and `Cache-Control: private, no-cache`.

Omitting `anonymous` defaults to `false`. Anonymous entries return `author: null`
to every viewer, including the original author and administrators. Their owner ID
remains private in the database so the author can still delete the entry.
`canDelete` reflects the current viewer's permission: only the author or an
administrator can delete an entry. The frontend uses this flag without needing
the private identity.

## Host controls

- `GET /api/admin/guests` -> `{ items: Guest[] }`.
- `POST /api/admin/guests { name, phone?: string }` -> `{ guest: Guest, invitationUrl, expiresAt }` (201).
- `PUT /api/admin/guests/{id} { name, phone }` -> `{ guest: Guest, invitation: { invitationUrl, expiresAt } | null }`;
  an empty number removes it. Numbers are international (`+41 79 123 45 67` or
  `0041…`), stored as `+41791234567`; others fail with `invalid_phone`. When the
  number of a guest with access changes, including its removal, their invitation
  is replaced in the same transaction: the old link stops working and the new
  one is returned. Renaming alone, and any edit of a revoked guest, issues none.
- `POST /api/admin/guests/{id}/invitation {}` -> `{ invitationUrl, expiresAt }`.
  Replaces an unused link and reactivates a revoked guest with the same identity;
  previously revoked browser sessions remain invalid.
- `DELETE /api/admin/guests/{id}` -> 204; revoke the guest and all their sessions.
  Admins cannot revoke themselves. Existing photos/messages retain attribution.
- `DELETE /api/admin/guests/{id}/record` -> 204; deletes a revoked guest for good
  (`guest_active` otherwise). Their messages become anonymous and their media and
  questions lose their author; their sessions, profile, welcome progress, votes,
  upvotes, vote option (with its ballots) and werewolf seats are removed. It waits
  for uploads still in preparation (`guest_uploads_pending`) and refuses while
  they play or lead a running werewolf game (`guest_in_game`).

Only these administrator responses carry `Guest.phone`.

Host access is created locally with a CLI command or at server startup when
`PRINT_ADMIN_INVITATION` is enabled (the Compose default). Startup reuses the oldest
active administrator, creating `Admin` only if none exists; it replaces that
administrator's invitation while retaining sessions. No public route creates an
administrator. The host copies an invitation, or opens WhatsApp with it written
out for a guest whose number is known (`whatsapp://send`, so the link stays on
the device); the app itself sends no email, SMS or WhatsApp message.
