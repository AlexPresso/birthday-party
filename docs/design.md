# Birthday party design brief

This brief records the user's selected design. Update it when the host makes a
new decision; do not revisit the rejected directions without a reason.

## Confirmed

- A friendly app for a birthday party: first used for a 30th, and meant to be
  reused by other hosts.
- A Next.js frontend with a Go backend.
- Bottom navigation in order: `Programme`, `Médias`, `Livre d'or`, `Infos`
  only while the host shows the information page, then
  `Paramètres` only for administrators, and `Profil` last for everyone with app
  access. Show icons and the circular profile photo; only the current tab also
  shows its label. Translate accessible names and tooltips in the supported
  languages.
- Events and other content that become available later.
- A guestbook with named messages and an optional anonymous posting checkbox.
- Invite-only access through personal activation links and pre-created profiles.
- Simple, readable code and a responsive, performant experience.
- Interface language follows the phone/browser's preferred supported language:
  French, English, German, Italian or Spanish, with English as the fallback.

## Selected direction: "K · Neige", dark with one orange accent

On 2026-11-12 the host chose a single dark theme, meant to suit any party so
other hosts can reuse the app. It replaces the cream and dark plum themes. Every
reference image in this folder was drawn in those previous colors: use them for
layout only. Photographs, names and messages in any mockup are
illustrative and must not be seeded into the application.

- **Theme.** Dark only; do not follow the device's light preference. Background
  `#100F0E`, surfaces `#1B1917` and `#292623`, borders `#33302C`, text `#F5F1EA`,
  secondary text `#A29B92`.
- **Accent.** Orange `#FF6A1F`, with amber `#FFB547` for times and the ring
  gradient. A filled accent always carries dark text, so another party can swap
  `--accent` in `frontend/src/app/tokens.css` without losing contrast. Use the
  accent for the one main action on a screen and for the current tab.
- **Type.** Unbounded for page titles, the age, times and the featured vote
  question; Figtree for everything else. Do not use italics or uppercase,
  letter-spaced labels for emphasis.
- **Shapes.** Pill buttons, round icon buttons, 18px cards, 24px featured cards
  and photos. Cards sit on a surface color without a border; an outlined dashed
  card means locked or empty.
- **Snow.** Fine pale flakes fall slowly behind the top of each page and fade
  out before the content. It is decoration only: it never overlaps text, and it
  is still under reduced motion.
- **Tab changes.** Pressing a dock tab slides the page towards that tab (48px,
  with a short fade) while the dock stays put and its orange pill glides to
  the new tab. This uses React's `<ViewTransition>` through
  `components/page-transition.tsx`, wrapped around each party page, and the
  direction each dock link declares. Browser back, refreshes and in-page
  updates do not slide. Under reduced motion the page swaps instantly.
- **Fonts.** Keep font files and their licenses under `frontend/public/fonts/`;
  do not request fonts from guests' browsers through an external service.

The birthday identity comes from the actual participants and content. The earlier
scrapbook, photobooth, garden, illustrated-pop, anthracite, editorial, poster,
ticket and chalet proposals were not selected. Keep decoration restrained and
let the app's tasks lead the layout.
Do not invent party details, guest contributions, dates, or activity counts.

## Layout and visual language

- Design for guests using phones, then adapt deliberately for larger screens.
- On PC, center the party shell at 90% width without a fixed pixel cap, with
  wider internal gutters on tablets and PCs. Above
  960px, the media list view uses two columns and the mosaic uses four; the
  guestbook places its composer beside a single reading column. Profile identity
  and controls sit side by side. An open featured vote sits beside the agenda,
  preserving event order and ballot state. Settings use a persistent vertical
  sidebar and an editor to its right above 960px, following Instagram's desktop
  settings layout. Settings editors fill the remaining width and the welcome builder
  uses its existing columns. Keep the navigation in a centered floating dock on
  every screen size, with the upload banner above it. Phones retain the
  single-column layouts. Use CSS breakpoints without duplicating mounted
  controls or requests.
- Keep headings and content aligned to a shared page gutter. Center empty states
  and the waiting greeting; align forms, messages and authored step content for
  reading. Use quiet borders to separate content rather than enclosing every row.
- Use 44px or larger touch targets, accessible translated names and visible focus.
  The dock has calendar, images and open-book icons, an administrator-only
  settings gear, then the circular avatar at the far right. Use an initial when
  no photo is available. Do not repeat the profile link in the header.
- Put the round add button at the right of the brand row, with circular
  category covers below it; the selected category wears an accent ring. Load
  covers through the authorized category response. Use initials for empty
  categories. The mosaic is the default view and opening a photo gives its
  actions. The list view shows an author row, a rounded square preview and a
  download action for each independent media item, with the other file actions
  in the author's overflow menu. Do not add per-item sequence counters or a
  thumbnail strip that suggests a grouped carousel. Keep the view switch flat.
  Keep upload limits
  in the accessible Add description and validation, without a technical paragraph
  above the feed. Show uploads in a pill centered above the dock, in the
  dock's own shape and surface: an accent ring that fills around the file's
  preview, the sent/total count, and a chevron. It is as wide as its content
  and floats throughout the party tabs. Keep welcome widget queues inline and
  independent, with the same pill. Touching the pill raises a bottom sheet
  with each file's status, errors and retry/removal controls; from 960px the
  sheet becomes a compact dialog above the dock.
  Keep sending and server preparation distinct. Only when every file is ready,
  close the ring into an accent disc with a dark check, show the added count
  and let a brief burst of the snowfall's particles rise from the ring, then
  dismiss after two seconds with a short fade. Keep the open sheet until the
  guest closes it, and pause dismissal while a control has keyboard focus;
  cancel pending dismissal when another file arrives. Failures remain visible
  and retryable from the pill. Persist bounded dismissed upload IDs in session
  storage so completed pills do not reappear after reload. Skip the burst and
  the slides under reduced motion, and never fetch private media merely to
  decorate a queue.
- Put the first available open vote in a compact card with its real question,
  its three leading options (avatars for guests, short labels for free-text
  choices) and a Vote action that opens the vote's own page. Present the remaining
  programme as agenda rows with a time column and fine dividers. Show only the
  authorized teaser and unlock information for locked events.
- Question activities ("Sans filtre") have their own page at `/programme/[id]`,
  linked from the agenda and programme settings. Follow the approved
  [activity mockup](questions-reference.png): a Programme back link, large title,
  short rules and two ticket icons with the server's remaining joker count.
  Use tabs for pending, answered and skipped questions, keep the server's vote
  ordering and highlight the first pending question with the accent tint. Upvote buttons
  show their count and selected state. On PC, use the 90% shell with the list on
  the left and an anonymous composer on the right. On mobile, a primary action
  opens the composer in a bottom sheet; preserve its draft on dismissal, resize
  and failures. Support Escape, focus restoration and reduced motion.
  Host controls mark oral answers, confirm spending a joker, and open or close
  submissions. Closing stops new questions and votes, while remaining questions
  can still be answered. Questions may be daring, answers are honest, and there
  are exactly two jokers for the activity. Mockup questions are illustrative only.
- Center a large circular profile photo and name, followed by an outlined photo
  button. Below a divider, show a compact Notifications row with a real switch,
  then a separate photo removal row and red logout. A switch is enabled only
  after browser permission and server registration succeed; preserve unsupported
  and denied guidance. Choosing a photo starts its upload immediately; update
  the avatar after the server accepts it. Do not show a separate preview,
  crop explanation or Save button on Profile. Keep format guidance accessible
  and show it with validation errors. Preserve the saved avatar on upload
  failure and offer a retry for the selected file.
- The guestbook has a plain message field, anonymous checkbox and Publish button.
  Hide redundant signature and visibility paragraphs from the default visual
  layout while retaining accessible guidance. Entries use a single reading
  column with dividers and overflow actions. Anonymous entries have a filled
  neutral avatar and no identifying author data.
- Settings groups navigation rows under Party, Guests and access, and Photos
  and videos. Party contains details including age, programme and the welcome
  sequence; guest settings contain profiles and invitation links and invitation-page copy;
  media settings contain category visibility and upload limits. On desktop, keep
  these groups in a quiet left sidebar with a highlighted active row and a fine
  vertical divider. Open party details by default; show one editor on the right.
  Switching sections saves the outgoing editor and preserves drafts and browser
  history. A save failure keeps the current editor visible. Do not slide the
  desktop sidebar or show a back-to-menu button there. On mobile, each row opens
  its own page: it slides in across the whole screen from the right while the
  list drifts back and fades, and returning reverses it. Every settings title
  is plain text on the page; only the round back button stays pinned while
  scrolling. Use
  `/parametres?section=…` for direct links and browser history. Keep visited
  editors mounted so returning to the list preserves drafts, and restore focus
  to the originating row. Respect reduced motion and keep inactive pages inert.
  Save editable settings when a field loses focus and before returning to the
  menu, without Save buttons. A successful save shows nothing: announce it to
  screen readers only, and keep visible messages for errors and for results
  the host must see, such as a copied link. Keep pending edits and errors
  visible, and remain on the editor if validation or saving fails. Changes made during a request
  must remain intact and be saved by the next queued request. Each configuration
  page saves its own fields while preserving the other saved configuration
  values; serialize those writes. Creation, deletion and vote/welcome transitions
  remain explicit actions. The party-details row uses the birthday cake icon.
  Invitation languages use one scope selector with retained drafts.
  Use compact rows, with an icon, label, saved value on the
  right when relevant, and a chevron. Keep longer descriptions accessible without
  adding a second visible line to every row. Show actual saved age and upload
  limits in the list; preserve the three groups and sliding subpages.
- The information page follows the settings layout. On phones it opens on a
  vertical menu of the host's tab titles, and a title slides its text in with a
  back arrow. From 960px the titles stay in a list on the left and the selected
  text fills the right. A page with one tab shows it directly.
- Media is the first destination after authentication when full access is open.
  During the host-led welcome, guests see a separate waiting screen without tabs.
  Use a personalized welcome heading while waiting, then show the current
  host-authored step in the app theme. Do not add a separate greeting.
  Before the first unlock, show the waiting screen without a Start button.
  Automatically show step one when the host unlocks it. Later unlocks leave
  guests on their current step. Show Next only when the following step is
  available, and keep Previous so guests can revisit earlier unlocked steps.
  Preserve their position across reloads and keep locked steps private.
  Allow logout and show a retry action when connection checks fail. Administrators
  prepare the sequence and control waiting, each unlock and opening from settings.
  A global Required switch makes late arrivals follow all steps before entry,
  including after opening. Existing participants enter explicitly when ready.
  Opening unlocks remaining steps; required participants finish them first.
  Preserve widget selections and transfers when the host unlocks another step.
  Administrators can edit steps at any time. Apply saved changes live while
  retaining each guest's numeric position, or the last unlocked position if the
  sequence becomes shorter. Text corrections preserve widget selections;
  changing widget types, order or upload destinations resets the affected guest's
  active widget context. Accepted uploads keep their original destination and
  completed guests keep access. Do not invent step content. Programme includes
  timed surprises; there is no separate home or surprises tab.
- A welcome step consists of an ordered list of widgets, with no fixed title or
  text outside that list. The supported widgets are title, text, profile photo,
  media upload and enabling notifications. Render them in the host's chosen order.
  Titles and text may
  repeat or be omitted; preserve authored wording. A profile-photo widget reuses
  the photo editor with an explicit preview and save step. Keep feedback
  and selections across unchanged updates; changing steps removes the widgets.
  The host controls unlocks regardless of widget completion; after entering
  step one automatically, guests choose when to advance.
- The host's editor separates the ordered step list, the selected step's widget
  canvas and a widget palette. Drag a palette item into the canvas to insert it
  at the indicated position; drag widget handles to reorder. Provide add buttons,
  keyboard-accessible move controls, visible drop feedback and move announcements.
  Preserve each widget's content, settings and focus while reordering. Keep each
  step's draft together when moving steps. Stack areas on phones and keep the
  palette reachable; use columns only when the available width supports them.
  A step supports up to 12 widgets, including at most one profile-photo widget,
  one notification widget and one rules widget.
- The rules widget shows each rule as its own checkbox row with a large touch
  target; the host types them one per line. While a rule is unticked, hide Next
  and Enter the app and say that every rule must be ticked to continue. Keep
  partial ticks through live updates, show an accepted list fully ticked, and
  let the guest untick. Never tick a rule for the guest.
  Widget settings belong beside the affected content. Profile photo has no
  parameters; media upload chooses its destination. Keep future settings specific
  to a real widget rather than exposing a generic JSON editor.
- Media-upload widgets let guests send photos and videos during the current
  step, with the same queued progress and error feedback as the gallery. Their
  settings choose the main gallery or a named category. Explain who can view the
  destination; guests can submit to an assigned private category without seeing
  its files. Each widget shows its own queue, while transfers share the same
  concurrency limit. Keep the welcome screen focused on sending media.
  Administrators create categories and change public/private visibility in
  settings. Public categories appear as filters in the Media tab; private ones
  appear only to administrators. Use text labels for visibility, not color alone.
  Mark private destinations with the localized suffix `(catégorie privée)` beside
  the category name instead of a separate explanatory paragraph. Use the same
  label in category selectors, upload destinations and the gallery/slideshow.
- Give the next useful action a clear place on each screen.
- The notification widget uses a bell and an explicit Enable notifications action.
  Show enabled only after the browser and server agree; offer retry after failures.
  Declining never prevents continuing the welcome. Explain how to restore denied
  permission and, on iPhone/iPad, how to add the app to the Home Screen.
  Reuse the control in Profile so guests can enable or disable notifications later.
  Notifications contain generic translated copy and open the guest's current
  welcome position; they must not move the guest to another step.
- Keep strong text contrast and a single action color, as described above.
- Establish a small spacing scale and consistent alignment. Group related content
  closely and give major sections breathing room.
- Let photos and useful event information lead. Add personal details where they
  support the celebration without crowding controls or text.

## Photo and video sharing

- Make upload easy to find and operate with touch, keyboard, and screen readers.
- Explain supported files and limits when those are defined by the product.
- Show selected files, upload progress, success, and useful per-file errors.
  Use one combined progress bar per queue with a sent/total file counter,
  including files waiting to upload. Count server-accepted files as sent, while
  keeping preparation and failures visible in each file's status. Welcome media
  widgets keep separate counters for their own queues.
- Distinguish sending a file from waiting for preparation and being ready in the
  gallery. Guests can navigate between tabs while transfers continue. Accepted
  jobs survive reloads and server restarts; never imply an unsent file is saved.
- Preserve successful uploads when another file fails, and offer a clear retry.
- Give an empty gallery a welcoming explanation and an upload action.
- Use appropriately sized thumbnails, reserve image space, and load offscreen
  media on demand. Keep original-size files out of routine gallery rendering.
- Leave room for meaningful captions or accessible descriptions when available.
- Support JPEG/PNG/WebP photos and MP4/MOV/WebM videos up to 5 minutes and 4K
  input. Display the configured upload sizes from the API (15/100 MiB defaults).
  Display video thumbnails with a play marker.
  Open a native player with controls; play only when the guest chooses to.
- Offer a slideshow from the current gallery category. Show the category name
  while watching and never combine it with another category or the main gallery.
  Photos stay visible for five seconds after loading; videos play until their end,
  starting muted with native controls for sound. Loop through the category, load
  further pages as needed, and keep pause, previous/next and close controls visible.
  Support optional fullscreen, keyboard navigation and small phone screens.
  Pause while the browser tab is hidden and show retry feedback for failed files.

## Events and timed reveals

- Activities are individual events in the programme. From Add event, hosts choose
  an ordinary event or a vote, then complete one form containing the schedule and
  the settings for that type. Keep opening and closing a vote directly
  on its event controls. The Programme management shortcut opens the matching
  settings section. Preserve drafts and event identity when refreshing or editing.
- A vote has its own page at `/programme/[id]`, with a Programme back link and
  the question as its title. Every option is always listed, most votes first,
  with its live count and a thin bar showing its share of the leading option.
  A guest option shows the profile photo large enough to recognise the person
  (72px on phones, 88px from 960px) with an initial fallback; a free-text option
  shows its text only. Use a check and an accent outline to mark the selection,
  then require an explicit vote action fixed above the dock. Mark the viewer's
  saved choice in words, allow changing it until closure, and retain an unsent
  selection through refreshes, reorders and connection failures. When the host
  allows it, a labelled field under the list lets a guest type a new choice.
  A closed vote is read-only and marks its leading option or options, with a
  clear empty result when nobody voted.
- While preparing the draft, hosts choose the source of the options: guests,
  with the self-vote setting, or free-text choices, with a checkbox letting
  guests add their own. Opening and closing are the only transitions. Hosts can
  remove an option a guest added. Never show who voted for what, to anyone.
- Distinguish upcoming, available, and completed experiences with text as well as color.
- An upcoming reveal can offer a hint when the host wants one; do not expose
  content that is intended to remain hidden.
- Show a readable opening date and time converted to the party's timezone,
  without timezone suffixes or a timezone footer. A countdown may supplement
  this information; it should not be the only explanation.
- Handle loading, unavailable content, and failed refreshes with understandable
  messages and a useful next action.
- Keep feedback modest. Prefer CSS for small transitions and honor reduced motion;
  an animation must never be required to understand a reveal or finish an action.

## Identity, guestbook and settings

- The invitation shows the configured age inside a large ring with the accent
  gradient, under the snowfall.
- Every screen starts with the same brand row: the mark (a small cluster of
  lights) followed by the party name. The age appears only on the invitation.
- Programme and Médias have no visible page title; the dock's current tab names
  the screen. Keep their `h1` for assistive technology and place the party date
  or the round add button at the right of the brand row. Other screens keep a
  visible title.
- The media gallery opens as a mosaic that follows each photo's proportions,
  with the author's avatar and name in a pill on the photo. The list view stays
  available from the view switch.
- In the featured vote, the leading options and the vote button share one row.
- An invitation opens a personal welcome and an explicit `Entrer` action.
  Activation is a deliberate action; link previews must not consume invitations.
- Explain invalid, expired and already used invitations, with a clear route back
  to the host. Keep identity attached to a stable guest ID across new invitations.
- The guestbook has a welcoming empty state and a clear message composer. Display
  actual guest names, readable messages and posting dates. Handle submission errors.
- Place an unchecked anonymous posting checkbox beside the message composer.
  When selected, explain that the name will not appear. Anonymous messages show
  a neutral avatar and translated anonymous label, including to the host.
- Profile shows the guest identity and logout, without an About section.
  Choosing a profile photo uploads and saves it immediately. Guests can replace
  or remove it. Use initials when no photo is set. Show
  the saved photo in the navigation, named guestbook posts and the host's guest list;
  anonymous posts always keep their neutral icon.
  Host-only controls manage guests, invitations, event details and the programme.
- Keep administrative controls within settings so guest navigation stays simple.
- Settings includes birthday age, invitation copy and photo/video size limits.
  Use one scope selector for shared invitation text and language overrides,
  preserving drafts between scopes. Distinguish default, hidden and custom text explicitly.
  Save without restart and preserve drafts on errors. Invitation text is public;
  do not imply that it is private guest content.

## Language and authored content

Render the selected language from the first response, based on `Accept-Language`.
Regional preferences such as `fr-CH` use their base language. Translate interface
copy, accessibility labels, metadata, errors, confirmation dialogs and all states.
Keep the same informal, clear tone across languages, using `tu` in French.
Dates use the viewer's language and the party's explicit timezone.

Use short, ordinary sentences, as the host would when explaining the app to a
guest. Remove decorative slogans, redundant headings and repeated instructions.
Empty states describe what is missing and how to add it; do not promise that
content will arrive soon. Keep errors and confirmations specific about the
problem, the next step and any consequences.

Names, guestbook messages, party titles, descriptions and teasers stay in their
authors' language. Do not translate these automatically. The host can provide
localized invitation copy through administrator settings; a locale-specific value
takes precedence over a shared value, then the localized default. An explicitly
empty value hides that text. Keep labels readable on narrow screens in every
supported language, including longer German labels.

## Review and remaining inputs

Check representative phone and desktop layouts, including a real phone when
available. Review upload states, long text, empty galleries, locked and open reveals,
keyboard navigation, visible focus, contrast, touch targets, and reduced motion.

Event date, venue and actual content remain unset until the host supplies them.
The initial event timezone is configurable, defaulting to `Europe/Zurich`.
Once the host opens full access, active guests can view and contribute photos,
videos and messages; authors and hosts can
remove their contributions, and the host can moderate all contributions.
