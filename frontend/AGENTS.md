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

## Responsiveness and resource use

- Avoid unnecessary sequential requests. Keep client bundles small and use CSS
  for straightforward transitions; add animation libraries only for a real need.
- Use thumbnails and appropriately sized images in galleries. Load full-size
  media on demand, paginate growing collections, and release temporary previews.
- Make upload selection, progress, failure, retry, and completion understandable.
  Preserve a guest's selection when retrying is possible.
- Choose caching and refresh behavior explicitly for guest-specific data and
  scheduled reveals. Prevent shared caches from exposing protected content.
- Handle empty, loading, error, locked, and available states where relevant.

## Verification and setup

There is no frontend scaffold, package manager, or runnable check yet. During
setup, record the actual development, production build, lint, type-check, and
test commands here, along with any required local services or environment values
(names and examples only; never secrets).

For UI changes, inspect the rendered result with realistic content at phone and
desktop sizes. Check upload flows, focus, overflow, and relevant state changes.
Use screenshots to review visual claims. A successful build alone does not
verify usability or design quality; report unavailable checks honestly.
