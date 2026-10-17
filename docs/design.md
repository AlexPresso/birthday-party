# Birthday party design brief

This brief records the user's selected design. Update it when the host makes a
new decision; do not revisit the rejected directions without a reason.

## Confirmed

- A friendly app for a 30th birthday party.
- A Next.js frontend with a Go backend.
- Four tabs, in order: `Médias`, `Programme`, `Livre d'or`, `Paramètres` in French,
  with translated labels and unchanged routes in the other supported languages.
- Events and other content that become available later.
- A guestbook with named messages and an optional anonymous posting checkbox.
- Invite-only access through personal activation links and pre-created profiles.
- Simple, readable code and a responsive, performant experience.
- Interface language follows the phone/browser's preferred supported language:
  French, English, German, Italian or Spanish, with English as the fallback.

## Selected direction: dark plum

The user selected the final **G / Prune sombre / 4 onglets** mockup, inspired by
the practical organization of PlanIt's event app. See [the approved mockup](design-reference.png).
Use `gpt-taste` to translate its layout and hierarchy into an accessible interface.
The reference is a visual concept; its photographs and messages are illustrative,
not actual event content and must not be seeded into the production application.

Use a near-black plum background (`#151218`), slightly lighter surfaces (`#231D29`),
fine plum borders (`#3B3043`), light text (`#F3EEF5`), readable secondary text
(`#BEB1C5`), and mauve accents (`#B99ACB`). Primary buttons use dark text on mauve.
Use a crisp humanist sans-serif and medium-weight headings, compact readable
sections, modest rounded corners, and consistent outline icons.

The birthday identity comes from the actual participants and content. The earlier
scrapbook, photobooth, garden, illustrated-pop and anthracite proposals were not
selected. Keep decoration restrained and let the app's tasks lead the layout.
Do not invent party details, guest contributions, dates, or activity counts.

## Layout and visual language

- Design for guests using phones, then adapt deliberately for larger screens.
- Keep the four confirmed tabs in the same order, including translated labels.
  Use a fixed bottom navigation
  on phones and a comfortable equivalent on larger screens.
- Media is the first destination after authentication when full access is open.
  During the host-led welcome, guests see a separate waiting screen without tabs.
  Use a personalized welcome heading while waiting, then show the current
  host-authored step in the existing plum theme. Do not add a separate greeting.
  The host unlocks steps without moving guests. Show Start, Previous and Next
  controls so each guest advances when ready and can revisit unlocked steps.
  Preserve their position across reloads and keep locked steps private.
  Allow logout and show a retry action when connection checks fail. Administrators
  prepare the sequence and control waiting, each unlock and opening from settings.
  A global Required switch makes late arrivals follow all steps before entry,
  including after opening. Existing participants enter explicitly when ready.
  Opening unlocks remaining steps; required participants finish them first.
  Preserve widget selections and transfers when the host unlocks another step.
  Already unlocked steps are edited after restarting the welcome, so active
  participants keep the instructions they are following. Do not invent step
  content. Programme includes timed surprises; there is no separate home or surprises tab.
- A welcome step consists of an ordered list of widgets, with no fixed title or
  text outside that list. The supported widgets are title, text, profile photo,
  media upload and enabling notifications. Render them in the host's chosen order.
  Titles and text may
  repeat or be omitted; preserve authored wording. A profile-photo widget reuses
  the preview, save, replace and remove controls from settings. Keep feedback
  and selections across unchanged updates; changing steps removes the widgets.
  The host controls unlocks regardless of widget completion; guests choose when
  to advance.
- The host's editor separates the ordered step list, the selected step's widget
  canvas and a widget palette. Drag a palette item into the canvas to insert it
  at the indicated position; drag widget handles to reorder. Provide add buttons,
  keyboard-accessible move controls, visible drop feedback and move announcements.
  Preserve each widget's content, settings and focus while reordering. Keep each
  step's draft together when moving steps. Stack areas on phones and keep the
  palette reachable; use columns only when the available width supports them.
  A step supports up to 12 widgets, including at most one profile-photo widget
  and one notification widget.
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
  Reuse the control in settings so guests can enable or disable notifications later.
  Notifications contain generic translated copy and open the guest's current
  welcome position; they must not move the guest to another step.
- Use the same readable sans-serif family for headings and body content.
- Use a coherent color palette with strong text contrast and a clear action color.
- Establish a small spacing scale and consistent alignment. Group related content
  closely and give major sections breathing room.
- Let photos and useful event information lead. Add personal details where they
  support the celebration without crowding controls or text.

## Photo and video sharing

- Make upload easy to find and operate with touch, keyboard, and screen readers.
- Explain supported files and limits when those are defined by the product.
- Show selected files, upload progress, success, and useful per-file errors.
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

- The invitation badge pairs the configured age with a small cake icon with candles.
- The app header shows the configured age and guest profile without decorative stars.
- An invitation opens a personal welcome and an explicit `Entrer` action.
  Activation is a deliberate action; link previews must not consume invitations.
- Explain invalid, expired and already used invitations, with a clear route back
  to the host. Keep identity attached to a stable guest ID across new invitations.
- The guestbook has a welcoming empty state and a clear message composer. Display
  actual guest names, readable messages and posting dates. Handle submission errors.
- Place an unchecked anonymous posting checkbox beside the message composer.
  When selected, explain that the name will not appear. Anonymous messages show
  a neutral avatar and translated anonymous label, including to the host.
- Settings shows the guest identity and logout, without an About section.
  Guests can choose a profile photo, check a circular center-cropped preview,
  save it, replace it or remove it. Use initials when no photo is set. Show
  the saved photo in the header, named guestbook posts and the host's guest list;
  anonymous posts always keep their neutral icon.
  Host-only controls manage guests, invitations, event details and the programme.
- Keep administrative controls within settings so guest navigation stays simple.

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
localized invitation copy through environment variables; a locale-specific value
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
