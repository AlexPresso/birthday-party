import type { Welcome } from "./contracts";

// Guest movement takes precedence over an earlier read, even when that read
// observed a newer host unlock. The next refresh fills in the latest host state.
export function latestWelcome(
  previous: Welcome | null,
  next: Welcome,
): Welcome {
  if (!previous || next.progressRevision > previous.progressRevision)
    return next;
  if (next.progressRevision < previous.progressRevision) return previous;
  if (next.revision !== previous.revision)
    return next.revision > previous.revision ? next : previous;
  // Accepting or withdrawing the rules changes neither revision: the later
  // answer wins, and the signal sent after that commit corrects a stale read.
  return next.rulesAccepted === previous.rulesAccepted ? previous : next;
}
