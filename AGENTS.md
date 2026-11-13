# Birthday Party

## Product

A friendly app for a birthday celebration, first used for a 30th and meant to be
reused by other hosts with one installation per party. Guests share photos and
videos and discover events or surprises that become available later. Prioritize
easy mobile use, a distinctive visual identity, simple code, and responsive
interactions.

## Instruction map

- Before changing `frontend/`, read `frontend/AGENTS.md`.
- Before changing `backend/`, read `backend/AGENTS.md`.
- For interface design or copy, also read `docs/design.md`.
- Keep shared rules here and stack-specific rules in the relevant directory.
  Update guidance when implementation decisions make it outdated.

## Code language

- Write code identifiers, comments, docstrings, test descriptions, and internal
  diagnostics in English. Developer logs and CLI help/output must also be English.
- Apply the same rule to configuration comments and code examples in documentation.
- Translate interface text and accessibility labels into the phone/browser's
  preferred supported language: French, English, German, Italian or Spanish.
  Match regional language tags to their base language and fall back to English.
  Select the locale from `Accept-Language` during server rendering; do not add a
  language cookie or switcher. Preserve public URLs and API field names.
- Preserve host- and guest-authored content in its original language. Do not send
  names, messages, event details or other private content to translation services.

## Project skills

- Use the repository's [Code Simplifier](.agents/skills/code-simplifier/SKILL.md)
  for requested cleanup and a focused readability review after implementation in
  either stack. Limit that pass to the task's changes; preserve behavior and useful
  architecture boundaries. Apply the stack-specific skills alongside it.
- Use the repository's [Go Style Guide](.agents/skills/go-style-guide/SKILL.md)
  for Go implementation, reviews, refactors and architecture decisions. Apply the
  project-specific scope and simplicity rules in [backend/AGENTS.md](backend/AGENTS.md).
- Use the repository's [Vercel React Best Practices](.agents/skills/vercel-react-best-practices/SKILL.md)
  for React/Next.js implementation, reviews, refactors and performance work. Read
  relevant rules and apply project instructions first. Keep authenticated fetches
  `cache: "no-store"`; cross-request caches are only for explicitly public data.
  Go owns API endpoints, authorization and business mutations. Preserve the shared
  WebSocket refresh flow, and add dependencies only for a concrete benefit.
- Use the repository's [UX Writing](.agents/skills/ux-writing/SKILL.md) skill
  when creating or editing interface labels, descriptions, errors or empty states.
- Use the repository's [Humanizer](.agents/skills/humanizer/SKILL.md) skill to
  review descriptions and remove artificial phrasing without changing meaning.
- Read these local copies even if a skill with the same name is installed globally.
- Write conversational copy with clear actions and useful information. Use
  consistent `tu` in French and a similarly informal tone in other languages.
  Avoid generic slogans, sentimental clichés and forced slang. Preserve product
  facts, accessibility, and the meaning and order of the navigation labels.
- Keep each skill's supporting files and license in the repository so contributors
  can use them without a separate global installation.

## Architecture and simplicity

- Follow the ownership and dependency directions in [docs/architecture.md](docs/architecture.md).
  Keep frontend feature code together. The Go backend uses feature packages for
  hexagonal services, models and consumer-owned ports, with concrete infrastructure
  under `internal/adapters`. Keep the core independent of HTTP, SQL and adapters;
  compose dependencies in `internal/app`. Preserve complete atomic authorization
  and persistence operations at adapter boundaries.
- Use Next.js with TypeScript for the frontend and Go for the backend.
- Start with one frontend application and one Go service. Go owns business
  rules, authorization, persistence, and scheduled availability; Next.js owns
  presentation and browser interactions. Avoid duplicating domain logic.
- Implement the smallest clear solution to the current requirement. Prefer
  explicit data flow, focused functions, and concrete types. Add abstractions
  when they clarify an actual responsibility or recurring need.
- Introduce dependencies for a concrete benefit; consider their maintenance,
  runtime, and bundle costs. Prefer existing platform capabilities when adequate.
- Add services, queues, caching, and concurrency when a requirement or measurement
  justifies them. Document meaningful tradeoffs briefly near the affected code.

## Data and behavior

- Define guest access and photo visibility before implementing sharing. Enforce
  the chosen permissions on the backend for both reads and writes.
- The backend decides when an event or surprise is available. Do not send locked
  content or its media to an unauthorized client and merely hide it in the UI.
- Store scheduled instants in UTC and display them in the party's timezone.
  Omit timezone suffixes and repeated timezone notices from displayed dates.
- Validate untrusted input at boundaries. Keep secrets and private guest data
  out of source control, logs, and sample fixtures.
  The explicitly requested exception is the administrator invitation printed once
  at backend startup when `PRINT_ADMIN_INVITATION` is enabled. Ordinary request
  logs must still exclude invitation and session tokens.

## Quality and performance

- Optimize expensive work first: network round trips, database access, media
  transfer, and browser JavaScript. Bound collections and resource consumption.
- Measure representative behavior before adding optimization complexity. Define
  useful performance targets once traffic, devices, and hosting are known.
- Test meaningful behavior and failure cases, especially access control, unlock
  boundaries, and uploads. Keep test scope proportional to the change.
- Run the relevant available checks and review the actual diff. Report what was
  verified and any checks that could not run; do not claim unmeasured performance.
- Keep changes within the requested scope and preserve unrelated user work.

## Selected implementation

- The approved design is a single dark theme ("K · Neige"): warm near-black
  surfaces, one orange accent that always carries dark text when filled,
  Unbounded titles, Figtree text and a light snowfall behind page headers. It
  does not follow the device's light preference. The floating bottom dock keeps
  this order: `Programme`, `Médias`, `Livre d'or`, administrator-only
  `Paramètres`, then the circular `Profil` photo at the far right. Only the
  current tab shows its label beside the icon, where the width allows it.
  `/profil` opens for every participant with app access;
  guests visiting `/parametres` redirect there. Preserve translated accessible
  names and routes. Tab changes slide the page and glide the dock's pill; see
  `docs/design.md`.
- Guest profiles are prepared by the host. Individual, single-use invitation
  links activate a persistent session. A replacement link keeps the same identity.
- Guests can choose, replace or remove their own profile photo from Profile.
  Store normalized 256×256 JPEG avatars (at most 128 KiB) in PostgreSQL for atomic
  replacement. Versioned avatar URLs require an active session and full app access,
  except a guest's own avatar during a current `profile_photo` welcome action.
  Keep anonymous guestbook entries free of all author details, including avatars.
- The host starts a welcome sequence and unlocks its steps from settings. Waiting
  guests enter the first step automatically when it becomes available. After
  that, each guest chooses when to advance or return to a previous unlocked step.
  Persist their own position in PostgreSQL. Return only that guest's selected step.
  The global `required` switch makes late arrivals follow every step before
  entering, including after the host opens the app. Existing participants enter
  explicitly when ready; later unlocks never move them or interrupt their widgets.
  Go enforces each guest's effective access; administrators retain full access.
  Host commands use the shared revision; guest navigation and widget uploads use
  a separate stable progress revision. Keep initial access open until the host
  starts the welcome. Administrators can edit steps at any time. Keep each
  participant's numeric position, clamping it to the last unlocked position if
  the sequence shrinks; keep completed guests admitted. Preserve progress tokens
  for text-only corrections and edits to other steps. Rotate affected tokens
  when a position or current widget type, order or destination changes, and
  reject stale uploads while preserving already accepted jobs.
- Welcome steps contain an ordered list of 1 to 12 typed widgets, with no fixed
  title or body: `title`, `text`, `profile_photo`, `media_upload` and
  `enable_notifications`. Text and media widgets may repeat; allow at most one
  profile widget and one notification widget per step. The current
  profile widget grants access to the guest's own profile editor and avatar.
  Each media widget accepts queued uploads into its configured destination,
  without granting gallery or file access. Recheck its index and the current
  progress revision at acceptance and retain both with the upload destination.
  The host unlocks regardless of completion; after automatic entry to the first
  step, guests navigate explicitly. Hide Next until another step is available,
  and do not show a Start button while waiting. Add widget types explicitly with
  validation, permissions and a matching component.
- The notification widget asks permission only after an explicit guest click.
  Persist Web Push subscriptions with their guest, session and browser language;
  permission alone does not mean delivery is enabled. Guests can manage their
  current browser subscription in Profile. Keep VAPID keys in PostgreSQL and
  send bounded, generic welcome notifications through a durable outbox. Do not
  include guest names, authored instructions, media or invitation/session tokens
  in push payloads. Logout, expiry and revocation stop further delivery.
  The service worker handles push and clicks without caching private content.
- Media categories have an administrator-controlled public/private setting.
  Public means visible to signed-in guests with full app access; private means
  administrators only, including for files, thumbnails and video ranges. Owners
  receive upload acknowledgements without private media URLs. Publishing a
  category exposes its existing media without copying or moving files. The main
  gallery contains uncategorized media; categories are filters within `/photos`.
- PostgreSQL stores records and media jobs; a private local data directory stores
  photos, videos, thumbnails and pending inputs. Back up both together. This setup
  targets one Go process and persistent local storage.
- The schema starts from one baseline migration under
  `backend/internal/app/migrations/`. Later schema changes use new numbered SQL
  files there. Startup applies them transactionally and verifies recorded
  checksums; never edit an applied migration.
- Browsers always call same-origin `/api/*`. In production the Ingress sends it
  straight to Go, so uploads and the WebSocket never pass through Node; the
  Next.js rewrite proxies it only in local development and Compose. The public
  API contract is in `docs/api.md`. Frontend response validators check shape,
  enums, same-origin URLs and the invariants the interface relies on; length
  and count ceilings are enforced by Go alone.
- Activities are programme events themselves, with stable event IDs and an
  explicit type: `event` for ordinary entries and `vote` for voting. A vote has
  a question and its own page at `/programme/[id]`; the Programme tab only
  previews it. Its options come from one source chosen by the host: 2–200 active
  guests, shown with their profile photos and an optional self-vote setting (off
  by default), or up to 200 free-text choices of at most 80 characters. For
  free-text votes the host may let guests type a choice: it joins the option
  with the same text, ignoring case, or creates one, and takes their vote. A
  write-in option disappears with its last vote, and the host can remove one.
  Hosts choose the event type in settings and save its schedule and settings
  together, then open and close each vote; there is no reveal step. Freeze the
  source, host options and both settings after opening; allow question
  corrections. One choice per guest is replaceable while open.
  Keep ballots across event edits and schedule changes; remove them with the event.
  Each event has at most one vote extension. Keep its type fixed after creation.
  Omit draft vote events from guest lists and hide vote details in locked events.
  Every viewer of a vote always sees all options with their live counts, most
  votes first. Never expose who voted for what, to guests or administrators.
  Enforce current access,
  event availability, eligibility and vote state atomically in PostgreSQL.
  Use the existing programme WebSocket topic. Programme activities require full
  app access; they do not grant access during the welcome sequence. Add future
  activity types explicitly with validation, authorization and matching UI.
- Question activities use type `questions` ("Sans filtre") and have their
  own `/programme/[id]` activity page, linked from the
  programme and settings, with desktop and mobile layouts. Guests submit
  anonymous questions and upvote any pending question once, with an undo toggle.
  Keep author and voter identities out of all responses, including admin views.
  Limit each activity to 200 questions of 1,000 characters. Hosts open and close
  submissions/voting, mark oral answers, or spend one of exactly two shared
  jokers. Answered and skipped questions are terminal; serialize resolutions
  and enforce the joker budget in PostgreSQL. Preserve questions, upvotes and
  spent jokers across event edits. Require full app access and event availability,
  hide drafts/locked details, and use the shared programme invalidation topic.
- Use one shared, authenticated `/api/realtime` WebSocket per browser tab for
  welcome, upload queue and programme updates. Send scoped invalidation signals
  after database commits; fetch current data through the authorized HTTP APIs.
  Reconnect with backoff and resynchronize after reconnect or returning to the
  page. Do not restore recurring browser HTTP polling. Keep socket payloads free
  of private content, and close connections when their session loses access.
- The media gallery retains `/photos` and `/api/photos` for existing links.
  Keep uploaded videos byte-for-byte for playback and download, preserving their
  resolution, frame rate, codecs, audio and metadata. FFprobe validates videos and
  FFmpeg generates JPEG thumbnails only; never downscale or transcode the video.
  Existing converted videos remain usable, but deleted originals cannot be restored.
  Apply the same permissions to originals and thumbnails, count both in storage
  quotas, preserve them during recovery and remove them together. Serve media
  and avatars with a validator and `Cache-Control: private, no-cache`, and
  authorize before answering 304; JSON responses stay `no-store`. Compose includes
  FFmpeg. Keep processing and file sizes bounded.
  Accepted uploads enter a persistent queue; two background workers prepare them.
  Preserve progress across navigation and restore accepted jobs after reload.
  Show one combined upload progress bar per visible queue, with a count of
  server-accepted files over the total. Keep file-specific preparation status,
  errors and retry controls; separate welcome widgets retain their own queues.
- Guestbook posts can be anonymous. Keep their owner ID private in PostgreSQL for
  deletion permissions; never send their identity to guests or administrators.
- Birthday age, invitation copy and image/video upload limits live in PostgreSQL
  and are editable in administrator settings without restarting. Import existing
  `BIRTHDAY_AGE`, `INVITATION_*`, `MAX_IMAGE_SIZE_MB` and `MAX_VIDEO_SIZE_MB` values
  from the repository-root `.env` once; saved values take precedence thereafter.
  Keep deployment configuration in `.env`; Compose must not load frontend env files.
- Upload limits default to 15/100 MiB and accept integers from 1 to 1024.
  Go applies a settings snapshot to each incoming request; preserve already
  accepted jobs when limits decrease. Expose effective limits in the media and
  profile APIs. The development proxy in Next has a fixed 1024 MiB plus 64 KiB
  ceiling; the production Ingress must allow the same.
- Invitation copy resolves the saved locale-specific text before the shared text
  and localized default. A null value inherits; an explicitly empty value hides
  the text. Preserve this distinction during environment import, editing and rendering.
  Only age and invitation copy are public; configuration writes require an admin.
- The event timezone defaults to `Europe/Zurich` and is editable by the host.
  Date, venue, actual guests and content are not seeded or invented.
  Format dates in the viewer's language while preserving the party's timezone.
- Compose enables `PRINT_ADMIN_INVITATION` by default. Startup reuses the oldest
  active administrator, creating a technical `Admin` profile only if none exists.
  Each start replaces its invitation without invalidating existing sessions.
- Refer to `README.md` and scoped instruction files for commands. Keep lockfiles
  committed and verify framework guidance against the installed versions.
