import { localInput, utcInput } from "../../lib/dates.ts";
import type { PartyEvent, Vote } from "./contracts.ts";
import { replaceEvent } from "./vote-model.ts";

export type VoteDraft = {
  question: string;
  candidateIds: number[];
  allowSelfVote: boolean;
};

/** The host's editable copy of an event; dates are browser-local input values. */
export type EventDraft = {
  id: number | null;
  type: PartyEvent["type"];
  revision: number;
  title: string;
  description: string;
  teaser: string;
  startsAt: string;
  unlockAt: string;
  vote: VoteDraft | null;
};

const textFields = [
  "title",
  "description",
  "teaser",
  "startsAt",
  "unlockAt",
] as const;

export function newEventDraft(
  type: PartyEvent["type"],
  title = "",
): EventDraft {
  return {
    id: null,
    type,
    revision: 0,
    title,
    description: "",
    teaser: "",
    startsAt: "",
    unlockAt: "",
    vote:
      type === "vote"
        ? { question: "", candidateIds: [], allowSelfVote: false }
        : null,
  };
}

export function eventDraft(event: PartyEvent): EventDraft {
  return {
    id: event.id,
    type: event.type,
    revision: event.revision,
    title: event.title,
    description: event.description,
    teaser: event.teaser,
    startsAt: localInput(event.startsAt),
    unlockAt: localInput(event.unlockAt),
    vote: event.vote
      ? {
          question: event.vote.question,
          candidateIds: event.vote.candidates.map((candidate) => candidate.id),
          allowSelfVote: event.vote.allowSelfVote,
        }
      : null,
  };
}

export function sameDraft(a: EventDraft | null, b: EventDraft | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Applies a completed save to the draft. Fields the host changed while the
 * request was running keep their newer value for the next save; the others
 * take what the server stored.
 */
export function mergeSavedDraft(
  current: EventDraft,
  submitted: EventDraft,
  saved: EventDraft,
): EventDraft {
  const merged = { ...current, id: saved.id, revision: saved.revision };
  for (const field of textFields) {
    if (current[field] === submitted[field]) merged[field] = saved[field];
  }
  if (current.vote && submitted.vote && saved.vote) {
    merged.vote = { ...current.vote };
    if (current.vote.question === submitted.vote.question)
      merged.vote.question = saved.vote.question;
    if (
      JSON.stringify(current.vote.candidateIds) ===
      JSON.stringify(submitted.vote.candidateIds)
    )
      merged.vote.candidateIds = saved.vote.candidateIds;
    if (current.vote.allowSelfVote === submitted.vote.allowSelfVote)
      merged.vote.allowSelfVote = saved.vote.allowSelfVote;
  }
  return merged;
}

/** Candidates and the self-vote rule are fixed once a vote has opened. */
export function frozenVote(event: PartyEvent | undefined): Vote | null {
  return event?.vote && event.vote.status !== "draft" ? event.vote : null;
}

/** The error code that keeps a draft from being saved, if any. */
export function draftProblem(
  draft: EventDraft,
  frozen: Vote | null,
  candidateIds: number[],
): "invalid_event" | "invalid_activity" | null {
  if (!draft.title.trim()) return "invalid_event";
  if (!draft.vote) return null;
  const candidatesValid =
    frozen !== null || (candidateIds.length >= 2 && candidateIds.length <= 200);
  return draft.vote.question.trim() && candidatesValid
    ? null
    : "invalid_activity";
}

/**
 * The body of the create or update request. `saved` is the latest known
 * version of the event being edited and supplies the revision to replace.
 */
export function eventRequestBody(
  draft: EventDraft,
  saved: PartyEvent | undefined,
  candidateIds: number[],
) {
  const frozen = frozenVote(saved);
  return {
    type: draft.type,
    ...(draft.id ? { revision: saved?.revision ?? draft.revision } : {}),
    title: draft.title.trim(),
    description: draft.description.trim(),
    teaser: draft.teaser.trim(),
    startsAt: utcInput(draft.startsAt),
    unlockAt: utcInput(draft.unlockAt),
    vote: draft.vote
      ? {
          question: draft.vote.question.trim(),
          candidateIds: frozen
            ? frozen.candidates.map((candidate) => candidate.id)
            : candidateIds,
          allowSelfVote: frozen
            ? frozen.allowSelfVote
            : draft.vote.allowSelfVote,
        }
      : null,
  };
}

/** Adds or replaces a saved event and keeps the list in programme order. */
export function withSavedEvent(events: PartyEvent[], saved: PartyEvent) {
  const updated = events.some((event) => event.id === saved.id)
    ? replaceEvent(events, saved)
    : [...events, saved];
  return updated.sort(
    (a, b) =>
      (a.startsAt || "9999").localeCompare(b.startsAt || "9999") || a.id - b.id,
  );
}
