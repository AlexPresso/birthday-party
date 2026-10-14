# Birthday party design brief

This is a working brief. Keep confirmed requirements distinct from design ideas,
and update it as the host shares their preferences.

## Confirmed

- A friendly app for a 30th birthday party.
- A Next.js frontend with a Go backend.
- A tab for uploading and viewing pictures.
- Events and other content that become available later.
- Simple, readable code and a responsive, performant experience.

## Working direction

A personal invitation that gradually becomes a shared memory album.
Aim for warmth, playfulness, and an adult celebration; let the person's interests,
real photos, and familiar expressions supply the character.
Use the `gpt-taste` skill to develop a coherent interface around this brief.
The exact theme, colors, fonts, app name, and copy remain open to the host's style.
Do not invent party details, guest contributions, dates, or activity counts.

## Layout and visual language

- Design for guests using phones, then adapt deliberately for larger screens.
- Keep a short, clearly labeled tab navigation. Party, Photos, and Surprises are
  possible labels, not a confirmed information architecture.
- Give the next useful action a clear place on each screen.
- Choose expressive headings and an easy-to-read body face; keep the font set small.
- Use a coherent color palette with strong text contrast and a clear action color.
- Establish a small spacing scale and consistent alignment. Group related content
  closely and give major sections breathing room.
- Let photos and useful event information lead. Add personal details where they
  support the celebration without crowding controls or text.

## Photo sharing

- Make upload easy to find and operate with touch, keyboard, and screen readers.
- Explain supported files and limits when those are defined by the product.
- Show selected photos, upload progress, success, and useful per-file errors.
- Preserve successful uploads when another file fails, and offer a clear retry.
- Give an empty gallery a welcoming explanation and an upload action.
- Use appropriately sized thumbnails, reserve image space, and load offscreen
  media on demand. Keep original-size files out of routine gallery rendering.
- Leave room for meaningful captions or accessible descriptions when available.

## Events and timed reveals

- Distinguish upcoming, available, and completed experiences with text as well as color.
- An upcoming reveal can offer a hint when the host wants one; do not expose
  content that is intended to remain hidden.
- Show a readable opening date and time with the applicable timezone. A countdown
  may supplement this information; it should not be the only explanation.
- Handle loading, unavailable content, and failed refreshes with understandable
  messages and a useful next action.
- Keep feedback modest. Prefer CSS for small transitions and honor reduced motion;
  an animation must never be required to understand a reveal or finish an action.

## Review and remaining inputs

Check representative phone and desktop layouts, including a real phone when
available. Review upload states, long text, empty galleries, locked and open reveals,
keyboard navigation, visible focus, contrast, touch targets, and reduced motion.

Refine the brief when available: visual references; the person's interests and
preferred tone; event date and timezone; guest access; and who may upload, view,
or remove photos. These open choices should not block unrelated implementation.
