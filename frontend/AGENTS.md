# Frontend guidance

Read `../AGENTS.md` for shared architecture and behavior requirements.

## Design

- Use the `gpt-taste` skill available in this Codex environment for substantial
  interface design and visual changes. Follow `../docs/design.md` for this
  product's identity, content, and interaction goals.
- Keep the design brief self-contained so contributors without the skill can
  follow the same direction. Do not embed machine-specific skill paths here.
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

## Source ownership and dependencies

- `src/app/` owns routes, layouts, metadata and server composition. Keep route
  paths stable; feature directories do not define public URLs.
- `src/features/` groups components, hooks, CSS, response schemas and types by
  responsibility: `guests`, `profile`, `party`, `media`, `programme`, `guestbook`,
  `welcome`, `notifications` and `settings`. Add files within the owning feature
  before adding another directory or generic abstraction.
- `settings` composes host and guest controls from the other features. Guest
  administration belongs to `guests`, party details to `party`, event editing to
  `programme`, and category editing to `media`.
- `welcome` composes the profile, media and notification controls. Those features
  must not import welcome UI. Keep welcome draft types and labeling in
  `welcome/editor-model.ts`, independent of editor components.
- Feature contracts live in each feature's `contracts.ts`. Reuse guest/author
  schemas from `guests` and media destination schemas from `media` where needed.
  Shared scalar validation and date formatting belong in `lib/schema.ts` and
  `lib/dates.ts`. Keep transport validation at the API boundary.
- `src/components/` contains reusable presentation such as Avatar, navigation and
  UI notices. `src/lib/` contains shared HTTP, realtime, localization and browser
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

- Avoid unnecessary sequential requests. Keep client bundles small and use CSS
  for straightforward transitions; add animation libraries only for a real need.
- Use thumbnails and appropriately sized images in galleries. Load full-size
  media on demand, paginate growing collections, and release temporary previews.
- Make upload selection, progress, failure, retry, and completion understandable.
  Preserve a guest's selection when retrying is possible.
- Choose caching and refresh behavior explicitly for guest-specific data and
  scheduled reveals. Prevent shared caches from exposing protected content.
- Keep default Link prefetching for the four tabs so Next can prepare shared
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
plain CSS, Lucide icons, and Zod response validation. Node 24 LTS is recommended.
Keep the lockfile committed and use `npm ci` for a reproducible install.

Run these commands from `frontend/`:

- `npm run dev`: Next development server at `http://127.0.0.1:3000`.
- `npm run build`: production compilation and framework type checks.
- `npm start`: production server after a successful build.
- `npm run typecheck`: generate Next route types, then TypeScript without emit.
- `npm run lint`: ESLint with the matching Next configuration.
- `npm run format`: format tracked source and guidance with Prettier.
- `npm run format:check`: verify formatting without changing files.
- `npm test`: Node tests for API boundary validation and upload constraints.

Start the Go service too. `API_INTERNAL_URL` defaults to
`http://127.0.0.1:8080`; `.env.example` documents it. Browser requests always use
the same-origin `/api` proxy. Production rewrites are resolved during the build:
set the intended internal API URL for both build and runtime. Root scripts manage
the full stack and browser tests; see `../README.md`.

Use the repository-root `.env` for shared configuration. Docker Compose reads
it automatically and forwards the declared variables to each service; it does
not load `frontend/.env` or `frontend/.env.local`. Run `docker compose up` after
changing values; Compose recreates affected containers without rebuilding the
image. Container API, port, host and production-mode settings remain explicit
in Compose. The root development script also loads the root `.env`; local
frontend env files are only needed when launching Next.js independently.
For invitation copy, missing environment variables use defaults; explicitly
empty values hide their text. Preserve that distinction in Compose and Next.js.
Locale-specific `INVITATION_TITLE_FR/EN/DE/IT/ES` and
`INVITATION_DESCRIPTION_FR/EN/DE/IT/ES` take precedence over their unsuffixed
variables, which take precedence over localized defaults. Read them at runtime.

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

Use one shared WebSocket connection per browser tab for `welcome`, `uploads` and
`programme` invalidations. Validate the small message contract and refetch only
the affected mounted resources through the existing API. Initial subscription,
reconnection and return to a visible page resynchronize current state. Coalesce
signals during a request into a trailing refresh; abort requests on unmount.
Reconnect with bounded, jittered backoff and detect stalled connections using
heartbeats. Do not add recurring HTTP polling as a fallback. Session close code
4401 requires a full navigation to the invitation page. Release the socket and
listeners when the last consumer unmounts. Server timers signal programme unlocks.

The shared layout validates the backend session and forwards cookies on private
server fetches with `cache: "no-store"`. The backend owns the HttpOnly cookie.
Use a full navigation after logout or session expiry to discard the private
client router cache. Never put invitation tokens in queries, logs, or storage.
Invitation fragments are read only in the browser, previewed without consuming
them, and removed after deliberate acceptance.

The host-controlled welcome uses `/attente`, outside the party layout. API status
423 means guests must return there; handle it in server fetches, client API calls
and upload requests. Never fetch or embed future welcome steps in guest pages.
Guest browsers share one authenticated `/api/realtime` WebSocket with upload and
programme updates. Refresh `/api/welcome` on its invalidation signal, connection
readiness and return to the page. Keep the displayed step during connection failures.
Use a full navigation when effective guest access closes to discard cached private
routes. Host commands unlock steps; each guest chooses next/previous and enters
explicitly with finish. The public `open` field describes that guest's effective
access, so redirect to `/photos` only when it becomes true. A global Required
switch makes late arrivals follow the full sequence even after host opening.
Administrators retain the four tabs and unlock steps in settings. Save the switch
separately without losing step drafts. Preserve drafts on conflicts. Already
unlocked steps stay immutable until the host restarts from an open application.
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

The `enable_notifications` widget and settings share the browser notification
control. Ask permission only from an explicit click and retain that user gesture;
never prompt on mount or block guest navigation when permission is declined.
Show enabled only after permission, a browser push subscription and server
registration all succeed. Handle unsupported browsers, insecure origins, denial,
network failures and iOS Home Screen installation with translated guidance.
Use `/sw.js` only for push display and same-origin notification clicks. It must
not cache authenticated pages or API responses. Keep subscriptions tied to the
current session; an existing browser subscription must not silently bind another
guest identity. Allow retry after failed registration and disabling in settings.

Profile settings accept JPEG/PNG/WebP photos using `/api/profile` image limits.
Show a centered preview before saving, preserve the selection after failed saves,
and release local object URLs. Refresh the server-rendered header after changes.
Use the shared Avatar component with native authenticated images and initial
fallbacks. Avatar URLs are versioned, same-origin API paths; anonymous guestbook
posts keep their neutral icon and never receive an avatar URL.

Authenticated media deliberately uses native images: the Go service already
creates thumbnails, and Next image optimization would not forward guest cookies.
Uploads accept at most 20 selected files and run two requests concurrently.
The authenticated layout owns transfers so tab navigation does not cancel them.
POST /api/photos returns a persistent job with 202. Refresh the owner's /api/uploads
queue when its WebSocket signal arrives, distinguish transfer from waiting/preparation,
and refresh the gallery
when a job becomes ready. Reload restores accepted jobs; unsent browser files
still require the page to remain open. Reuse X-Upload-ID for ambiguous retries.
Each image must satisfy the backend's JPEG/PNG/WebP and pixel limits. Videos
accept MP4/MOV/WebM up to 5 minutes and 4K input; Go converts them to
MP4 and generates JPEG thumbnails. Render thumbnails in the gallery and use a
native video player with controls, playsInline and no autoplay when opened.
The gallery can explicitly start a slideshow of its current category, including
uncategorized media. Keep a snapshot of the loaded list and fetch subsequent
metadata pages only as needed, retaining the category on every request. Show
each loaded image for five seconds; play videos muted by default until they end.
Loop after the last page. Provide pause, previous/next, close and optional native
fullscreen controls. Pause playback while the document is hidden, abort pending
requests on close and restore focus to the launch button. File or page failures
pause the slideshow and offer a retry instead of silently skipping content.
The gallery API includes limits.imageBytes/videoBytes from the root environment
(MAX_IMAGE_SIZE_MB/MAX_VIDEO_SIZE_MB, defaults 15/100 MiB, range 1–1024).
Use those values for browser validation and translated size labels.
The Next proxy permits the larger configured limit plus 64 KiB and a 10-minute
timeout. next.config.ts and the standalone startup.mjs share the runtime parser;
Compose changes must apply on recreation without rebuilding the image.

The chosen theme is dark plum. Keep these four tabs and their order: `Médias`,
`Programme`, `Livre d'or`, `Paramètres` in French. Capitalize labels in the
selected language while keeping routes unchanged. Host controls live inside
settings. Empty states must never invent guest contributions or events.
Scheduled timestamps are submitted as UTC; host date inputs identify their
browser timezone, and guest dates use the party's explicit timezone.

The anonymous guestbook checkbox starts unchecked. Anonymous entries have a
null author for every viewer; display the translated anonymous label and use
the backend's canDelete flag to offer deletion without needing an author ID.
Preserve the draft and checkbox state after submission errors.

For UI changes, inspect the rendered result with realistic content at phone and
desktop sizes. Check upload flows, focus, overflow, and relevant state changes.
Use screenshots to review visual claims. A successful build alone does not
verify usability or design quality; report unavailable checks honestly.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
