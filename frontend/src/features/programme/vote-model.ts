import type { PartyEvent, Vote, VoteEvent, VoteOption } from "./contracts.ts";

/** A custom choice holds up to this many characters once trimmed. */
export const choiceLength = 80;
/** A vote holds up to this many options, write-ins included. */
export const optionLimit = 200;

export function replaceEvent(
  events: PartyEvent[],
  saved: PartyEvent,
): PartyEvent[] {
  return events.map((event) =>
    event.id === saved.id && event.revision <= saved.revision ? saved : event,
  );
}

/** Whether the viewer may read this event's vote: it exists and is unlocked. */
export function isReadableVote(
  event: PartyEvent | undefined,
): event is VoteEvent {
  return event !== undefined && !event.locked && event.vote !== null;
}

export function totalVotes(vote: Vote) {
  return vote.options.reduce((total, option) => total + option.votes, 0);
}

/** The highest count among the options: zero when nobody has voted. */
export function leadingVotes(vote: Vote) {
  return vote.options.reduce(
    (highest, option) => Math.max(highest, option.votes),
    0,
  );
}

/** Two custom choices are the same when only case or outer spaces differ. */
export function choiceKey(label: string) {
  return label.trim().toLowerCase();
}

/** What keeps the viewer from choosing an option, if anything. */
export function optionObstacle(
  vote: Vote,
  option: VoteOption,
  guestId: number,
): "inactive" | "self" | null {
  if (!option.active) return "inactive";
  if (!vote.allowSelfVote && option.guestId === guestId) return "self";
  return null;
}

/**
 * The option the viewer picked without sending it yet. A realtime update can
 * remove it or make it unavailable: the pick is then `lost` and the ballot
 * falls back to the recorded vote.
 */
export function pendingChoice(
  vote: Vote,
  selection: number | null,
  guestId: number,
): { option: VoteOption | null; lost: boolean } {
  if (selection === null) return { option: null, lost: false };
  const option = vote.options.find((item) => item.id === selection);
  return option && optionObstacle(vote, option, guestId) === null
    ? { option, lost: false }
    : { option: null, lost: true };
}

/** The next state of a vote with its action label and confirmation question. */
export const voteTransitions = {
  draft: {
    status: "open",
    label: "activities.open",
    confirmation: "activities.openConfirm",
  },
  open: {
    status: "closed",
    label: "activities.close",
    confirmation: "activities.closeConfirm",
  },
} as const;
