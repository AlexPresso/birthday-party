# Birthday Party

## Product

A friendly app for a 30th birthday celebration. Guests will share photos and
discover events or surprises that become available later. Prioritize easy mobile
use, a personal visual identity, simple code, and responsive interactions.

## Instruction map

- Before changing `frontend/`, read `frontend/AGENTS.md`.
- Before changing `backend/`, read `backend/AGENTS.md`.
- For interface design or copy, also read `docs/design.md`.
- Keep shared rules here and stack-specific rules in the relevant directory.
  Update guidance when implementation decisions make it outdated.

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
- Store scheduled instants in UTC. Establish the event's intended time zone
  before implementing scheduling, and label displayed times unambiguously.
- Validate untrusted input at boundaries. Keep secrets and private guest data
  out of source control, logs, and sample fixtures.

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

## Bootstrap status

Only guidance files exist; application scaffolds and runnable checks have not
been created. During application setup, replace this note and record the exact
development, build, formatting, lint, type-check, and test commands in the scoped
instruction files. Verify framework guidance against the selected versions.

Guest access, database, photo storage and retention, hosting, and event time zone
remain open decisions. Resolve each when it becomes relevant to implementation.
