import { localInput, utcInput } from "../../lib/dates.ts";
import type { PartyEvent, Vote } from "./contracts.ts";
import {
  choiceKey,
  choiceLength,
  optionLimit,
  replaceEvent,
} from "./vote-model.ts";

/**
 * The host's editable vote settings. Both lists stay in the draft, so trying
 * the other source does not discard the guests or the choices entered so far.
 * A save sends, and afterwards keeps, the list of the selected source only.
 */
export type VoteDraft = {
  question: string;
  choices: Vote["choices"];
  /** The guests to vote for while `choices` is "guests". */
  candidateIds: number[];
  /** The typed choices, in the host's order, while `choices` is "custom". */
  labels: string[];
  allowSelfVote: boolean;
  allowWriteIns: boolean;
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

/** The translated message that says why a draft cannot be saved. */
export type DraftProblem =
  | "errors.invalid_event"
  | "errors.invalid_activity"
  | "errors.invalid_vote_label"
  | "errors.vote_option_limit"
  | "activities.choiceEmpty"
  | "activities.choiceDuplicate"
  | "activities.choicesRequired";

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
        ? {
            question: "",
            choices: "guests",
            candidateIds: [],
            labels: [],
            allowSelfVote: false,
            allowWriteIns: false,
          }
        : null,
  };
}

/** The settings the host gave a saved vote; write-ins belong to the guests. */
function voteDraft(vote: Vote): VoteDraft {
  return {
    question: vote.question,
    choices: vote.choices,
    candidateIds: vote.options
      .map((option) => option.guestId)
      .filter((guestId) => guestId !== null),
    labels: vote.options
      .filter((option) => option.guestId === null && !option.writeIn)
      .map((option) => option.label),
    allowSelfVote: vote.allowSelfVote,
    allowWriteIns: vote.allowWriteIns,
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
    vote: event.vote ? voteDraft(event.vote) : null,
  };
}

/**
 * Whether two drafts hold the same event. The server lists options by votes
 * and name, never in the order they were typed, so the order of the custom
 * choices is not a difference.
 */
export function sameDraft(a: EventDraft | null, b: EventDraft | null) {
  return (
    JSON.stringify(a && unordered(a)) === JSON.stringify(b && unordered(b))
  );
}

function unordered(draft: EventDraft): EventDraft {
  if (!draft.vote) return draft;
  return {
    ...draft,
    vote: { ...draft.vote, labels: [...draft.vote.labels].sort() },
  };
}

function sameList(a: readonly unknown[], b: readonly unknown[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The saved choices in the order of the draft, so a completed save does not
 * shuffle the rows the host is editing.
 */
function inDraftOrder(saved: string[], draft: string[]) {
  const rows = new Map(draft.map((label, row) => [choiceKey(label), row]));
  const row = (label: string) => rows.get(choiceKey(label)) ?? draft.length;
  return [...saved].sort((a, b) => row(a) - row(b));
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
    const vote = { ...current.vote };
    const sent = submitted.vote;
    if (vote.question === sent.question) vote.question = saved.vote.question;
    if (vote.choices === sent.choices) vote.choices = saved.vote.choices;
    if (sameList(vote.candidateIds, sent.candidateIds))
      vote.candidateIds = saved.vote.candidateIds;
    if (sameList(vote.labels, sent.labels))
      vote.labels = inDraftOrder(saved.vote.labels, sent.labels);
    if (vote.allowSelfVote === sent.allowSelfVote)
      vote.allowSelfVote = saved.vote.allowSelfVote;
    if (vote.allowWriteIns === sent.allowWriteIns)
      vote.allowWriteIns = saved.vote.allowWriteIns;
    merged.vote = vote;
  }
  return merged;
}

/** The source, the choices and their rules are fixed once a vote has opened. */
export function frozenVote(event: PartyEvent | undefined): Vote | null {
  return event?.vote && event.vote.status !== "draft" ? event.vote : null;
}

/** Custom choices must be filled in, distinct and enough to vote on. */
function customChoicesProblem(vote: VoteDraft): DraftProblem | null {
  const labels = vote.labels.map((label) => label.trim());
  if (labels.includes("")) return "activities.choiceEmpty";
  if (labels.some((label) => label.length > choiceLength))
    return "errors.invalid_vote_label";
  if (new Set(labels.map(choiceKey)).size !== labels.length)
    return "activities.choiceDuplicate";
  if (labels.length > optionLimit) return "errors.vote_option_limit";
  // Guests can fill a vote that starts with fewer than two choices.
  if (labels.length < 2 && !vote.allowWriteIns)
    return "activities.choicesRequired";
  return null;
}

/** What keeps a draft from being saved, if anything. */
export function draftProblem(
  draft: EventDraft,
  frozen: Vote | null,
  candidateIds: number[],
): DraftProblem | null {
  if (!draft.title.trim()) return "errors.invalid_event";
  if (!draft.vote) return null;
  if (!draft.vote.question.trim()) return "errors.invalid_activity";
  if (frozen) return null;
  if (draft.vote.choices === "custom") return customChoicesProblem(draft.vote);
  return candidateIds.length >= 2 && candidateIds.length <= optionLimit
    ? null
    : "errors.invalid_activity";
}

/** The vote settings of a request: the list and the rule of its source only. */
function voteRequest(vote: VoteDraft) {
  const question = vote.question.trim();
  return vote.choices === "guests"
    ? {
        question,
        choices: vote.choices,
        candidateIds: vote.candidateIds,
        allowSelfVote: vote.allowSelfVote,
        allowWriteIns: false,
      }
    : {
        question,
        choices: vote.choices,
        labels: vote.labels.map((label) => label.trim()),
        allowSelfVote: false,
        allowWriteIns: vote.allowWriteIns,
      };
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
      ? voteRequest(
          // An opened vote resubmits its saved settings with the question.
          frozen
            ? { ...voteDraft(frozen), question: draft.vote.question }
            : { ...draft.vote, candidateIds },
        )
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
