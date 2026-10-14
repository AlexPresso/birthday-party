# Birthday Party

## Product

A friendly app for a 30th birthday celebration. Guests will share photos, videos and
discover events or surprises that become available later. Prioritize easy mobile
use, a personal visual identity, simple code, and responsive interactions.

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

## Project writing skills

- Use the repository's [UX Writing](.agents/skills/ux-writing/SKILL.md) skill
  when creating or editing interface labels, descriptions, errors or empty states.
- Use the repository's [Humanizer](.agents/skills/humanizer/SKILL.md) skill to
  review descriptions and remove artificial phrasing without changing meaning.
- Read these local copies even if a skill with the same name is installed globally.
- Write conversational copy with clear actions and useful information. Use
  consistent `tu` in French and a similarly informal tone in other languages.
  Avoid generic slogans, sentimental clichés and forced slang. Preserve product
  facts, accessibility, and the meaning and order of the four navigation labels.
- Keep each skill's supporting files and license in the repository so contributors
  can use them without a separate global installation.

## Architecture and simplicity

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

- The approved design is dark plum with the tabs `Médias`, `Programme`,
  `Livre d'or`, `Paramètres` in French. Capitalize translated labels while preserving their
  order and routes; see `docs/design.md` and its reference image.
- Guest profiles are prepared by the host. Individual, single-use invitation
  links activate a persistent session. A replacement link keeps the same identity.
- SQLite stores records; a private local data directory stores photos, videos and
  thumbnails. Back up both together. This initial setup targets one Go process
  and persistent local storage, not ephemeral or horizontally scaled hosting.
- The frontend proxies same-origin `/api/*` to Go. The public API contract is in
  `docs/api.md`; keep frontend validators and backend responses aligned.
- The media gallery retains `/photos` and `/api/photos` for existing links.
  Videos use FFmpeg to produce private MP4 playback files and JPEG thumbnails;
  Compose includes FFmpeg. Keep processing and file sizes bounded.
- Guestbook posts can be anonymous. Keep their owner ID private in SQLite for
  deletion permissions; never send their identity to guests or administrators.
- Shared runtime configuration belongs in the repository-root `.env`.
  `docker compose up` must apply it directly; do not load frontend env files in
  Compose or require a rebuild for birthday age and invitation copy changes.
- MAX_IMAGE_SIZE_MB and MAX_VIDEO_SIZE_MB configure upload sizes (15/100 MiB
  defaults). The API exposes effective limits to the gallery; the standalone
  frontend applies its proxy cap at startup. Compose changes need no rebuild.
- Invitation copy resolves a locale-specific variable (such as
  `INVITATION_TITLE_FR`) before its global variable and then its localized default.
  An explicitly empty value hides the text. Keep this distinction at every layer.
- The event timezone defaults to `Europe/Zurich` and is editable by the host.
  Date, venue, actual guests and content are not seeded or invented.
  Format dates in the viewer's language while preserving the party's timezone.
- Compose enables `PRINT_ADMIN_INVITATION` by default. Startup reuses the oldest
  active administrator, creating a technical `Admin` profile only if none exists.
  Each start replaces its invitation without invalidating existing sessions.
- Refer to `README.md` and scoped instruction files for commands. Keep lockfiles
  committed and verify framework guidance against the installed versions.
