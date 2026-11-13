# Frontend guidance

Read `../AGENTS.md` for shared architecture and behavior requirements.

## Design

- Follow `../docs/design.md` for this product's identity, content, and
  interaction goals. Colors, radii and font families are tokens in
  `src/app/tokens.css`; use them instead of literal values. The theme is dark
  only, so do not add `prefers-color-scheme` branches.
- Keep the design brief self-contained so contributors without the skill can
  follow the same direction. Do not embed machine-specific skill paths here.
- Every stylesheet starts with `@layer base, components, features;` and wraps
  its rules in one of those layers: tokens and element defaults in `base`, shared
  classes in `components`, everything under `src/features` in `features`. An
  unlayered rule beats all layered ones, so never leave a new file unwrapped.
  Feature-specific rules live with their feature, not in `globals.css`.
- Pages are served with a nonce-based Content Security Policy from
  `src/proxy.ts`. Do not add inline scripts, external origins or `eval`; widen
  the policy deliberately when a feature truly needs it. HSTS belongs to the
  Ingress.
- Use semantic HTML, accessible names, visible focus, readable contrast, and
  comfortable touch targets. Support keyboard navigation and reduced motion.
- Preserve coherent typography, spacing, color, and reusable controls across
  screens. Choose imagery and decoration for their contribution to the party.

## Next.js and TypeScript

- Use the App Router and strict TypeScript. Keep Server Components as the default
  and place client boundaries around the parts that need browser interaction.
- Keep Go as the authority for permissions and unlock status. Frontend checks
  explain the state to guests; they do not enforce access to protected content.
- Keep state close to the components that own it. Add shared state or a state
  library when cross-screen behavior actually requires it.
- Group code by feature as the application grows. Extract components and hooks
  around useful responsibilities rather than arbitrary size limits.
- Validate external data at its boundary; TypeScript types alone do not validate
  API responses. Keep the API contract consistent with the Go implementation.
  Response schemas check shape, enums, same-origin URLs and the invariants the
  interface relies on; leave length and count ceilings to Go, so raising a
  backend limit never blanks a page.

## Source ownership and dependencies

- `src/app/` owns routes, layouts, metadata and server composition. Keep route
  paths stable; feature directories do not define public URLs.
- `src/features/` groups components, hooks, CSS, response schemas and types by
  responsibility: `guests`, `profile`, `party`, `media`, `programme`, `guestbook`,
  `welcome`, `notifications` and `settings`. Add files within the owning feature
  before adding another directory or generic abstraction.
- `settings` composes host controls from the other features. `/profil` composes
  personal photo, notification and account controls independently. Guest
  administration belongs to `guests`, party details to `party`, event editing to
  `programme`, and category editing to `media`.
- `welcome` composes the profile, media and notification controls. Those features
  must not import welcome UI. Keep welcome draft types and labeling in
  `welcome/editor-model.ts`, independent of editor components.
- Feature contracts live in each feature's `contracts.ts`. Reuse guest/author
  schemas from `guests` and media destination schemas from `media` where needed.
  Shared scalar validation and date formatting belong in `lib/schema.ts` and
  `lib/dates.ts`. Keep transport validation at the API boundary.
- `src/components/` contains reusable presentation such as Avatar, navigation,
  the snow backdrop, page transitions and UI notices. Wrap each party page in
  `PageTransition`; dock links declare the slide direction with `transitionTypes`. `src/lib/` contains shared HTTP, realtime, localization and browser
  utilities. Neither directory imports routes or features; ESLint enforces this
  direction. Features also must not import routes.
- Import concrete files directly, without feature-wide barrel exports. Keep
  cross-feature dependencies deliberate and acyclic. Do not import settings
  composition from the features it combines.
- Feature `server.ts` files own server-only reads and per-request React cache
  wrappers. `lib/server-api.ts` owns the uncached authenticated HTTP transport.
  Keep server-only modules out of client imports and retain parallel independent
  reads in route composition.
- The persistent party layout owns the media UploadProvider. The shared realtime
  client remains in `lib/`; moving feature files must not create extra sockets or
  shorten the lifetime of uploads during tab navigation.

## Responsiveness and resource use

- At 960px, center the party shell at 90% of the viewport width without a fixed
  maximum, and use the desktop media,
  guestbook, profile and featured-vote layouts. Settings use a persistent vertical
  sidebar and one editor filling the remaining width. Use CSS breakpoints so
  resizing preserves forms, uploads and ballots. Desktop navigation remains a
  centered bottom dock; position upload banners above it. Verify 320px phones,
  tablets, laptops and wide monitors; see `../docs/design.md`.
- Avoid unnecessary sequential requests. Keep client bundles small and use CSS
  for straightforward transitions; add animation libraries only for a real need.
- Use thumbnails and appropriately sized images in galleries. Load full-size
  media on demand, paginate growing collections, and release temporary previews.
- Make upload selection, progress, failure, retry, and completion understandable.
  Preserve a guest's selection when retrying is possible.
- Choose caching and refresh behavior explicitly for guest-specific data and
  scheduled reveals. Prevent shared caches from exposing protected content.
- Keep default Link prefetching for navigation links so Next can prepare shared
  route information. Keep private page fetches uncached; full-page prefetch
  or longer router cache lifetimes need an explicit freshness strategy. Show
  pending feedback when a transition must wait, and measure production builds
  because automatic prefetching is disabled in development.
- Keep the initial loading boundary at `app/loading.tsx`. During tab changes,
  retain the current page until fresh content is ready and show feedback in the
  selected link. A loading boundary inside `(party)/` replaces every tab with a
  spinner and can trigger React's fallback reveal delay even on a fast connection.
- Handle empty, loading, error, locked, and available states where relevant.

## Verification and setup

The frontend uses Next.js 16.4 App Router, React 19.3, strict TypeScript, npm,
plain CSS, Lucide icons, and Zod response validation. Node 24 is required.
Keep the lockfile committed and use `npm ci` for a reproducible install.

Run these commands from `frontend/`:

- `npm run dev`: Next development server at `http://127.0.0.1:3000`.
- `npm run build`: production compilation and framework type checks.
- `npm start`: the standalone production server (`node startup.mjs`) after a
  successful build.
- `npm run typecheck`: generate Next route types, then TypeScript without emit.
- `npm run lint`: ESLint with the matching Next configuration.
- `npm run format`: format tracked source and guidance with Prettier.
- `npm run format:check`: verify formatting without changing files.
- `npm test`: Node unit tests for contracts, translations, realtime, autosave,
  drafts and uploads.
- `npm run test:runtime`: after a production build, verify the container startup's
  runtime backend selection for HTTP, WebSocket and server rendering.

Start the Go service too. `API_INTERNAL_URL` defaults to
`http://127.0.0.1:8080`; `.env.example` documents it. Browser requests always use
same-origin `/api`: the Next rewrite forwards it in development and Compose,
and the production Ingress sends it straight to Go. The container's `startup.mjs` updates the compiled
API rewrite from the runtime `API_INTERNAL_URL` before Next starts, including
WebSocket forwarding. Use an HTTP(S) origin without credentials or a path.
The image can be reused with different backend service names without rebuilding;
keep `.next/routes-manifest.json` writable by the container user. Root scripts manage the full stack and
browser tests; see `../README.md`.

Use the repository-root `.env` for shared configuration. Docker Compose reads
it automatically and forwards the declared variables to each service; it does
not load `frontend/.env` or `frontend/.env.local`. Run `docker compose up` after
changing values; Compose recreates affected containers without rebuilding the
image. Container API, port, host and production-mode settings remain explicit
in Compose. The root development script also loads the root `.env`; local
frontend env files are only needed when launching Next.js independently.
Go imports legacy birthday age, invitation copy and upload limits from the root
environment once. They then live in PostgreSQL and are edited in admin settings.
Read age and invitation copy from `/api/config` without cross-request caching.
Locale-specific text takes precedence over shared text and localized defaults.
Null inherits and an empty string hides the text; preserve both in the editor.

## Languages

Detect the locale from the request's `Accept-Language` header during server
rendering. Support French, English, German, Italian and Spanish; match regional
tags to their base language and fall back to English. Set the document language
and pass only the selected catalog to client components. Do not add a language
cookie or switcher, or render French first and replace it after hydration.

Translate all interface copy, including metadata, accessibility labels, errors,
confirmations, loading states and empty states. API failures contain a stable
`code` plus an English fallback `error`; translate the code at the presentation
boundary. Format dates and counts with `Intl` for the selected locale, keeping
the party's explicit timezone. Omit timezone suffixes and the programme timezone
footer. Host date inputs use the browser's timezone and retain their input hints.
Populate the saved party date after hydration without requiring focus. Preserve
the original UTC instant until the host edits or clears the date field.

Keep names, guestbook messages, party titles, event details and public teasers
exactly as supplied by their authors. A locked event with no public teaser has an
empty title; show the localized surprise placeholder without revealing private
content. Do not automatically translate authored content or send it to a service.
The party name is optional: an empty value uses the configured invitation title
or localized birthday fallback. Allow hosts to save other party details without
entering a custom name.

## Sessions and interface behavior

### Realtime

Use one shared WebSocket connection per browser tab for `welcome`, `uploads` and
`programme` invalidations. Validate the small message contract and refetch only
the affected mounted resources through the existing API, using the shared
`useRealtimeResource` hook. Server-rendered resources resynchronize on the
socket handshake, or once over HTTP if it fails; reconnection resynchronizes
too. A hidden page pauses without reporting a failure, and returning to it
reads again only when no socket is live or connecting. Coalesce
signals during a request into a trailing refresh; abort requests on unmount.
Reconnect with bounded, jittered backoff and detect stalled connections using
heartbeats. Do not add recurring HTTP polling as a fallback. Session close code
4401 requires a full navigation to the invitation page. Release the socket and
listeners when the last consumer unmounts. Server timers signal programme unlocks.

### Requests and confirmations

Browser requests go through `lib/api.ts` and fail as a translated connection
error after 15 seconds; multipart uploads have no deadline. A caller's own abort
stays an abort. Ask for confirmation with `useConfirm()` from
`components/confirm-dialog.tsx`, never `window.confirm`: browsers suppress native
dialogs in background tabs. Never open a dialog from an automatic save; a
programme conflict is resolved by the explicit "save my draft" action.
After an autosave, refresh the server-rendered route with `useRouteRefresh()`
from `lib/use-route-refresh.ts`, not `router.refresh()` directly: overlapping
refreshes make the router drop the next tab change and can remount the page.
Show a validation error below the fields it concerns, never above a control the
host may be about to press.

### Sessions

The shared layout validates the backend session and forwards cookies on private
server fetches with `cache: "no-store"`. The backend owns the HttpOnly cookie.
Use a full navigation after logout or session expiry to discard the private
client router cache. Never put invitation tokens in queries, logs, or storage.
Invitation fragments are read only in the browser, previewed without consuming
them, and removed after deliberate acceptance.

### Welcome sequence

The host-controlled welcome uses `/attente`, outside the party layout. API status
423 means guests must return there; handle it in server fetches, client API calls
and upload requests. Never fetch or embed future welcome steps in guest pages.
Guest browsers share one authenticated `/api/realtime` WebSocket with upload and
programme updates. Refresh `/api/welcome` on its invalidation signal, connection
readiness and return to the page. Keep the displayed step during connection failures.
Use a full navigation when effective guest access closes to discard cached private
routes. Waiting guests enter the first unlocked step automatically through the
normal welcome response; Go persists that position. Do not add a client progress
mutation for this transition. Hide Start while waiting and show Next only when
`canNext` is true. Later host unlocks preserve the current step; each guest chooses
next/previous and enters explicitly with finish. The public `open` field describes
that guest's effective access, so redirect to `/photos` only when it becomes true. A global Required
switch makes late arrivals follow the full sequence even after host opening.
Administrators retain full navigation and unlock steps in settings. Save the switch
separately without losing step drafts. Preserve drafts on conflicts. Allow editing
and reordering steps during every phase, including after opening access. Live
edits retain guests' numeric positions unless removed trailing steps require
clamping. Completed guests keep access. Text-only corrections and other-step
edits preserve the active widget instances; changed widget contexts receive a
new progress revision and discard unaccepted transfers and selections.
Responses carry host `revision` and guest `progressRevision`; compare both and reject
older responses after navigation. Key widgets by `progressRevision`, which host
unlocks preserve, so uploads and profile selections remain active.
Each step has an ordered list of typed widgets and no fixed title or body fields.
Render title, text, profile-photo, media-upload and notification widgets in their
saved order.
The current `profile_photo` widget mounts the shared photo editor on `/attente`
and fetches `/api/profile` only while active.
Keep it across unchanged responses; unmount and abort requests when the step changes.
Keep interactive controls outside the text's atomic live region. Saving a photo
updates the widget without refreshing or advancing the welcome route.
The host editor keeps stable draft keys while selecting or reordering steps.
Use a dedicated mouse/touch drag handle and accessible move controls; normal
scrolling and text selection must work outside the handle. Cancel interrupted
drags without mutating the draft, announce successful moves and preserve focus.
Keep the ordered step list, widget canvas and widget palette usable on narrow
screens. Allow dragging from the palette into the canvas and reordering widgets,
with add and move buttons as keyboard alternatives. Widget-specific settings
belong to focused forms with typed contracts. A step holds up to 12 widgets and
at most one profile-photo widget and one notification widget, neither with
settings. Text and media widgets can repeat. Strip local draft keys before saving.
Each media-upload widget has a typed category destination. Fetch its upload
context by widget index only while current, and key the step by progress revision.
Share one bounded uploader and queue subscription across the step's media widgets;
filter displayed queues and dismissal by widget index. Capture the destination,
progress revision and widget index per transfer and retry,
and abort unaccepted browser transfers when the step changes. Accepted jobs remain
durable. A ready job may have no photo because the category is private or welcome
access is still closed; show completion without fetching files in that case.
Admin settings create categories and change their visibility. The media gallery
filters uncategorized media or one accessible category; keep pagination, completed
uploads and retries tied to that destination. Public means signed-in guests,
private means administrators. Preserve category names as authored content.

### Notifications

The `enable_notifications` widget and Profile share the browser notification
control. Ask permission only from an explicit click and retain that user gesture;
never prompt on mount or block guest navigation when permission is declined.
Show enabled only after permission, a browser push subscription and server
registration all succeed. Handle unsupported browsers, insecure origins, denial,
network failures and iOS Home Screen installation with translated guidance.
Use `/sw.js` only for push display and same-origin notification clicks. It must
not cache authenticated pages or API responses. Keep subscriptions tied to the
current session; an existing browser subscription must not silently bind another
guest identity. Allow retry after failed registration and disabling in Profile.

### Profile photos

Profile settings accept JPEG/PNG/WebP photos using `/api/profile` image limits.
Upload immediately on Profile; the welcome widget keeps its centered preview
before saving. Preserve the file after failed uploads and release local object
URLs. Refresh the server-rendered navigation after changes.
Use the shared Avatar component with native authenticated images and initial
fallbacks. Avatar URLs are versioned, same-origin API paths; anonymous guestbook
posts keep their neutral icon and never receive an avatar URL.

### Media and uploads

Authenticated media deliberately uses native images: the Go service already
creates thumbnails, and Next image optimization would not forward guest cookies.
Uploads accept at most 20 selected files and run two requests concurrently.
The authenticated layout owns transfers so tab navigation does not cancel them.
POST /api/photos returns a persistent job with 202. Refresh the owner's /api/uploads
queue when its WebSocket signal arrives, distinguish transfer from waiting/preparation,
and refresh the gallery
when a job becomes ready. Reload restores accepted jobs; unsent browser files
still require the page to remain open. Reuse X-Upload-ID for ambiguous retries.
Each displayed queue has one combined progress bar and a localized sent/total
file counter. Count a file as sent only after server acceptance, including jobs
still being prepared. Include local waiting files in the total and deduplicate
transfers/jobs by upload ID. Keep individual status, errors, retries and removal
controls in expandable details without per-file progress bars. Show one compact
floating queue above the navigation throughout party tabs; welcome widgets keep
their own inline queues. Use a bounded cache of local image object URLs for
previews, release them on dismissal/eviction/unmount, and fetch remote thumbnails
only from authorized ready-job responses. When all items are ready, show success
for two seconds then fade away; keep expanded details open, preserve keyboard
focus and cancel dismissal
when the batch changes. Never automatically hide failures. Persist only a bounded
list of dismissed upload UUIDs in session storage to avoid replay after reload.
Each gallery post is an independent medium: omit per-item sequence counters and
the gallery filmstrip. The explicit slideshow retains its sequence controls.
Each image must satisfy the backend's JPEG/PNG/WebP and pixel limits. Videos
accept MP4/MOV/WebM up to 5 minutes and 4K input; Go preserves uploaded bytes
and generates JPEG thumbnails without re-encoding or downscaling the video.
Accept the original video MIME types in response validation. Render thumbnails in the gallery and use a
native video player with controls, playsInline and no autoplay when opened.
The media download link uses `?download=1`; Go supplies the filename and extension.
Playback and slideshow use the same stored file. Browser support depends on its
container and codecs; downloading remains available. Previously converted videos
keep their existing file.
The gallery can explicitly start a slideshow of its current category, including
uncategorized media. Keep a snapshot of the loaded list and fetch subsequent
metadata pages only as needed, retaining the category on every request. Show
each loaded image for five seconds; play videos muted by default until they end.
Loop after the last page. Provide pause, previous/next, close and optional native
fullscreen controls. Pause playback while the document is hidden, abort pending
requests on close and restore focus to the launch button. File or page failures
pause the slideshow and offer a retry instead of silently skipping content.
The gallery API includes limits.imageBytes/videoBytes from saved admin settings
(defaults 15/100 MiB, range 1–1024).
Use those values for browser validation and translated size labels.
The Next proxy permits 1024 MiB plus 64 KiB and a 10-minute timeout, allowing
settings increases without restart. Go enforces current limits per request.
next.config.ts and the standalone startup.mjs share this bounded ceiling.

### Navigation, questions and settings

The app has one dark theme. Keep the floating dock's icons in this order:
`Programme`, `Médias`, `Livre d'or`, administrator-only `Paramètres`, then the
round profile photo at the far right. Show the label of the current tab only,
and hide it when five tabs or a very narrow screen leave no room; always keep
translated accessible names and tooltips. The profile icon opens `/profil`
for all participants with app access. Guests visiting
`/parametres` redirect to `/profil` before admin data is fetched. Capitalize
translated labels and keep existing routes. Host controls live in settings.
Question activities use the existing programme editor and shared realtime topic.
Question activities open their own module page at `/programme/[id]` from the
agenda or settings; keep explicit activity-type routing in the App Router and
the UI inside the programme feature. Read only authorized, unlocked activities.
Guests send anonymous text and toggle one upvote per pending question. Show
server-sorted questions in pending/answered/joker tabs and the two-joker counter.
Host controls open/close submissions, mark answers and confirm spending a joker.
Use a right-hand composer on desktop and a modal bottom sheet on mobile, keeping
drafts on dismissal, resize, failures and realtime updates. Restore focus after
closing the sheet and resolving a question. Remove inaccessible activity content
when an event is deleted or relocked. Retain the Programme navigation highlight.
Never add polling or infer the authoritative joker budget from local state.
On Profile, selecting a photo immediately uploads it and updates the saved avatar.
Do not show a separate preview, crop explanation or Save button there. Disable
photo actions during the request, keep the current avatar on failure and allow
retrying the selected file. The welcome widget retains its explicit preview and
save step. Keep file-format guidance accessible and display validation errors.
Group admin settings into Party, Guests and access, and Photos and videos.
Open each editor as a sliding subpage at `/parametres?section=…`, with a back
arrow and native browser history on mobile. At 960px, retain the grouped menu
as a sidebar, highlight the selected link, show party details by default and
switch the right-hand editor without sliding or a back button. Subscribe only to
the breakpoint, keep one instance of each visited editor, and flush the outgoing
editor before switching; failed saves retain the editor and draft. Preserve visited editor drafts when returning
to the list, keep inactive pages inert, restore keyboard focus, and skip motion
when reduced motion is requested. Each configuration editor saves only its own
fields merged into the latest saved configuration; serialize those saves.
Age belongs inside party details, whose menu icon is a birthday cake. Put the
welcome sequence in the Party group. Editable settings save on field blur and
before returning to the menu, with no Save buttons. Keep the editor open on
validation or save failure, preserve edits made during a request, and serialize
queued writes using the latest accepted revision. Keep creation/deletion and
vote/welcome transitions explicit. Slide pages fully right-to-left on entry and
left-to-right on return; reduced motion skips the animation.
Empty states must never invent guest contributions or events.
Scheduled timestamps are submitted as UTC; host date inputs identify their
browser timezone, and guest dates use the party's explicit timezone.

### Programme activities

Activities are individual programme events. Keep their contracts, editor controls
and guest renderers in the programme feature; use stable event IDs and explicit
`event`, `vote` and `questions` branches with their own settings and behavior.
Choose the type when adding an event and save its metadata and type-specific
settings together. Do not add a nested activities list or a second save step.
The Programme administration shortcut opens the matching settings section.
Use the existing programme subscription for activity state and participation
updates. Preserve host drafts and unsent guest selections on unrelated refreshes;
restore the recorded vote after navigation. Do not fetch the admin guest list
from guest voting screens. Render only candidate names, authenticated avatars and
the viewer's own choice returned by the programme API.

The vote activity uses a searchable portrait grid and an explicit confirmation
button. Keep names visible, use initials when no photo exists, and convey
selection with a check plus color. Support keyboard selection and comfortable
touch targets. Show results only when the backend returns them after revelation;
candidate totals and individual voter identities must not be inferred from hidden
UI data. Host settings support adding, scheduling, configuring and deleting each
event, with separate open, close and reveal actions for votes. Candidate selection and
self-voting are editable only in draft; question corrections remain available.

### Guestbook

The anonymous guestbook checkbox starts unchecked. Anonymous entries have a
null author for every viewer; display the translated anonymous label and use
the backend's canDelete flag to offer deletion without needing an author ID.
Preserve the draft and checkbox state after submission errors.

### Reviewing interface changes

For UI changes, inspect the rendered result with realistic content at phone and
desktop sizes. Check upload flows, focus, overflow, and relevant state changes.
Use screenshots to review visual claims. A successful build alone does not
verify usability or design quality; report unavailable checks honestly.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
