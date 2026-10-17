import type { Welcome } from "./contracts";

// Guest movement takes precedence over an earlier poll, even when that poll
// observed a newer host unlock. The next poll fills in the latest host state.
export function latestWelcome(
  previous: Welcome | null,
  next: Welcome,
): Welcome {
  if (!previous || next.progressRevision > previous.progressRevision)
    return next;
  if (next.progressRevision < previous.progressRevision) return previous;
  return next.revision > previous.revision ? next : previous;
}
