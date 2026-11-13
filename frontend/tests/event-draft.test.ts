import test from "node:test";
import assert from "node:assert/strict";
import type {
  PartyEvent,
  Vote,
  VoteOption,
} from "../src/features/programme/contracts.ts";
import {
  draftProblem,
  eventDraft,
  eventRequestBody,
  frozenVote,
  mergeSavedDraft,
  newEventDraft,
  sameDraft,
  withSavedEvent,
  type EventDraft,
} from "../src/features/programme/event-draft.ts";

function option(changes: Partial<VoteOption> & { id: number }): VoteOption {
  return {
    label: `Option ${changes.id}`,
    guestId: null,
    avatarUrl: null,
    active: true,
    writeIn: false,
    votes: 0,
    ...changes,
  };
}

const guestVote: Vote = {
  question: "Who has the best costume?",
  status: "draft",
  choices: "guests",
  allowSelfVote: false,
  allowWriteIns: false,
  options: [
    option({ id: 31, label: "Alex", guestId: 1 }),
    option({ id: 32, label: "Sam", guestId: 2 }),
    option({ id: 33, label: "Robin", guestId: 3 }),
  ],
  myOptionId: null,
  canVote: false,
};

// The server lists choices by votes, then by name.
const customVote: Vote = {
  question: "What do we eat at midnight?",
  status: "draft",
  choices: "custom",
  allowSelfVote: false,
  allowWriteIns: true,
  options: [
    option({ id: 41, label: "Burgers" }),
    option({ id: 42, label: "Pizza" }),
  ],
  myOptionId: null,
  canVote: false,
};

function voteEvent(changes: Partial<PartyEvent> = {}): PartyEvent {
  return {
    id: 7,
    type: "vote",
    revision: 3,
    title: "Best costume",
    description: "Vote before midnight.",
    teaser: "",
    startsAt: "2026-07-01T18:30:00Z",
    unlockAt: null,
    locked: false,
    vote: guestVote,
    ...changes,
  };
}

test("a draft mirrors its event and submits the same instant in UTC", () => {
  const event = voteEvent();
  const draft = eventDraft(event);
  assert.equal(draft.id, 7);
  assert.equal(draft.revision, 3);
  assert.equal(draft.unlockAt, "");
  assert.deepEqual(draft.vote, {
    question: "Who has the best costume?",
    choices: "guests",
    candidateIds: [1, 2, 3],
    labels: [],
    allowSelfVote: false,
    allowWriteIns: false,
  });
  const body = eventRequestBody(draft, event, [1, 2, 3]);
  assert.equal(body.startsAt, "2026-07-01T18:30:00.000Z");
  assert.equal(body.unlockAt, null);
  assert.equal(body.revision, 3);

  const fresh = newEventDraft("vote");
  assert.deepEqual(fresh.vote, {
    question: "",
    choices: "guests",
    candidateIds: [],
    labels: [],
    allowSelfVote: false,
    allowWriteIns: false,
  });
  assert.equal(newEventDraft("questions", "Sans filtre").title, "Sans filtre");
  assert.equal(newEventDraft("event").vote, null);
  assert.equal("revision" in eventRequestBody(fresh, undefined, []), false);
});

test("a request carries the list and the rule of the chosen source only", () => {
  const draft = eventDraft(voteEvent());
  assert.deepEqual(
    eventRequestBody(
      { ...draft, vote: { ...draft.vote!, allowSelfVote: true } },
      undefined,
      [1, 2],
    ).vote,
    {
      question: "Who has the best costume?",
      choices: "guests",
      candidateIds: [1, 2],
      allowSelfVote: true,
      allowWriteIns: false,
    },
  );
  // The guests picked before switching stay in the draft, not in the request.
  const custom = {
    ...draft.vote!,
    question: " Midnight snack? ",
    choices: "custom" as const,
    labels: [" Pizza ", "Burgers"],
    allowSelfVote: true,
    allowWriteIns: true,
  };
  assert.deepEqual(
    eventRequestBody({ ...draft, vote: custom }, undefined, [1, 2]).vote,
    {
      question: "Midnight snack?",
      choices: "custom",
      labels: ["Pizza", "Burgers"],
      allowSelfVote: false,
      allowWriteIns: true,
    },
  );
  assert.equal(
    eventRequestBody(newEventDraft("event"), undefined, []).vote,
    null,
  );
});

test("a custom vote's draft holds the host's choices, not the guests' write-ins", () => {
  const withWriteIn: Vote = {
    ...customVote,
    status: "open",
    options: [
      option({ id: 43, label: "Crêpes", writeIn: true, votes: 2 }),
      ...customVote.options,
    ],
  };
  assert.deepEqual(eventDraft(voteEvent({ vote: withWriteIn })).vote, {
    question: "What do we eat at midnight?",
    choices: "custom",
    candidateIds: [],
    labels: ["Burgers", "Pizza"],
    allowSelfVote: false,
    allowWriteIns: true,
  });
});

test("a completed save keeps what the host typed during the request", () => {
  const submitted = eventDraft(voteEvent());
  // The server trims text and the host edits two fields meanwhile.
  const saved = eventDraft(
    voteEvent({ revision: 4, title: "Best costume", description: "Trimmed." }),
  );
  const current: EventDraft = {
    ...submitted,
    teaser: "Typed during the save",
    vote: { ...submitted.vote!, candidateIds: [1, 2] },
  };
  const merged = mergeSavedDraft(current, submitted, saved);
  assert.equal(merged.revision, 4);
  assert.equal(merged.description, "Trimmed.");
  assert.equal(merged.teaser, "Typed during the save");
  assert.deepEqual(merged.vote?.candidateIds, [1, 2]);
  assert.equal(merged.vote?.question, saved.vote?.question);
  assert.equal(sameDraft(merged, saved), false, "another save is still due");

  const untouched = mergeSavedDraft(submitted, submitted, saved);
  assert.equal(sameDraft(untouched, saved), true);
  assert.notEqual(untouched.vote, submitted.vote, "drafts are never shared");
});

test("a completed save keeps custom choices in the order the host typed them", () => {
  const saved = eventDraft(voteEvent({ revision: 4, vote: customVote }));
  const typed = {
    ...saved.vote!,
    labels: [" Pizza", "Burgers "],
  };
  const submitted: EventDraft = { ...saved, revision: 3, vote: typed };

  // The server answers in its own order; the rows stay where they are.
  const merged = mergeSavedDraft(submitted, submitted, saved);
  assert.deepEqual(merged.vote?.labels, ["Pizza", "Burgers"]);
  assert.equal(sameDraft(merged, saved), true, "nothing is left to save");

  // A row typed during the request is kept for the next save.
  const current: EventDraft = {
    ...submitted,
    vote: { ...typed, labels: [...typed.labels, "Crêpes"] },
  };
  const pending = mergeSavedDraft(current, submitted, saved);
  assert.deepEqual(pending.vote?.labels, [" Pizza", "Burgers ", "Crêpes"]);
  assert.equal(sameDraft(pending, saved), false);

  // Switching the source, or one of its rules, is a change to save.
  const switched: EventDraft = {
    ...saved,
    vote: { ...saved.vote!, choices: "guests" },
  };
  assert.equal(sameDraft(switched, saved), false);
  const closed = { ...saved, vote: { ...saved.vote!, allowWriteIns: false } };
  assert.equal(sameDraft(closed, saved), false);
});

test("a first save gives the draft its identity without losing newer edits", () => {
  const submitted = newEventDraft("event", "Dinner");
  const current = { ...submitted, title: "Dinner at eight" };
  const saved = eventDraft({
    ...voteEvent({ id: 12, revision: 1, title: "Dinner" }),
    type: "event",
    vote: null,
  });
  const merged = mergeSavedDraft(current, submitted, saved);
  assert.equal(merged.id, 12);
  assert.equal(merged.revision, 1);
  assert.equal(merged.title, "Dinner at eight");
  assert.equal(merged.startsAt, saved.startsAt);
});

test("drafts need a title, a question and 2 to 200 candidates until voting opens", () => {
  const event = voteEvent();
  const draft = eventDraft(event);
  assert.equal(draftProblem(draft, null, [1, 2]), null);
  assert.equal(
    draftProblem({ ...draft, title: "  " }, null, [1, 2]),
    "errors.invalid_event",
  );
  assert.equal(draftProblem(draft, null, [1]), "errors.invalid_activity");
  assert.equal(
    draftProblem(
      draft,
      null,
      Array.from({ length: 201 }, (_, index) => index + 1),
    ),
    "errors.invalid_activity",
  );
  assert.equal(
    draftProblem(
      { ...draft, vote: { ...draft.vote!, question: " " } },
      null,
      [1, 2],
    ),
    "errors.invalid_activity",
  );
  assert.equal(draftProblem({ ...draft, vote: null }, null, []), null);

  // An opened vote keeps its candidates, including guests who left since.
  const open = voteEvent({ vote: { ...guestVote, status: "open" } });
  assert.equal(frozenVote(event), null);
  assert.equal(frozenVote(open), open.vote);
  assert.equal(draftProblem(draft, frozenVote(open), [1]), null);
  assert.equal(
    draftProblem(
      { ...draft, vote: { ...draft.vote!, question: "" } },
      frozenVote(open),
      [1],
    ),
    "errors.invalid_activity",
    "the question stays required",
  );
  const body = eventRequestBody(
    {
      ...draft,
      title: " Best costume ",
      vote: {
        ...draft.vote!,
        question: " Who? ",
        choices: "custom",
        candidateIds: [1],
        labels: ["Ignored"],
        allowSelfVote: true,
        allowWriteIns: true,
      },
    },
    open,
    [1],
  );
  assert.equal(body.title, "Best costume");
  assert.deepEqual(body.vote, {
    question: "Who?",
    choices: "guests",
    candidateIds: [1, 2, 3],
    allowSelfVote: false,
    allowWriteIns: false,
  });
});

test("custom choices are filled in, distinct and at least two unless guests may add theirs", () => {
  const draft = eventDraft(voteEvent({ vote: customVote }));
  const withChoices = (labels: string[], allowWriteIns = false) =>
    draftProblem(
      { ...draft, vote: { ...draft.vote!, labels, allowWriteIns } },
      null,
      [],
    );
  assert.equal(withChoices(["Pizza", "Burgers"]), null);
  assert.equal(withChoices(["Pizza"]), "activities.choicesRequired");
  assert.equal(withChoices([]), "activities.choicesRequired");
  // Guests can fill a vote that starts with one choice, or none.
  assert.equal(withChoices(["Pizza"], true), null);
  assert.equal(withChoices([], true), null);

  assert.equal(withChoices(["Pizza", "  "]), "activities.choiceEmpty");
  assert.equal(withChoices(["Pizza", ""], true), "activities.choiceEmpty");
  assert.equal(withChoices(["Pizza", " pizza "]), "activities.choiceDuplicate");
  assert.equal(
    withChoices(["Pizza", "Burgers", "PIZZA"], true),
    "activities.choiceDuplicate",
  );
  assert.equal(withChoices(["Pizza", "x".repeat(80)]), null);
  assert.equal(
    withChoices(["Pizza", "x".repeat(81)]),
    "errors.invalid_vote_label",
  );
  const numbered = (count: number) =>
    Array.from({ length: count }, (_, index) => `Choice ${index + 1}`);
  assert.equal(withChoices(numbered(200)), null);
  assert.equal(withChoices(numbered(201)), "errors.vote_option_limit");

  // The guests picked earlier do not count for a custom vote.
  assert.equal(
    draftProblem(
      { ...draft, vote: { ...draft.vote!, labels: [], allowWriteIns: false } },
      null,
      [1, 2, 3],
    ),
    "activities.choicesRequired",
  );

  // Once open, the saved choices are resubmitted without the write-ins.
  const open: Vote = {
    ...customVote,
    status: "open",
    options: [
      option({ id: 43, label: "Crêpes", writeIn: true, votes: 1 }),
      ...customVote.options,
    ],
  };
  const frozen = voteEvent({ vote: open });
  assert.equal(withChoices([]), "activities.choicesRequired");
  assert.equal(
    draftProblem(
      { ...draft, vote: { ...draft.vote!, labels: [] } },
      frozenVote(frozen),
      [],
    ),
    null,
  );
  assert.deepEqual(
    eventRequestBody(
      { ...draft, vote: { ...draft.vote!, question: "Snack?", labels: [] } },
      frozen,
      [],
    ).vote,
    {
      question: "Snack?",
      choices: "custom",
      labels: ["Burgers", "Pizza"],
      allowSelfVote: false,
      allowWriteIns: true,
    },
  );
});

test("an overwrite submits the latest saved revision rather than the draft's", () => {
  const draft = eventDraft(voteEvent());
  const newer = voteEvent({ revision: 9 });
  assert.equal(eventRequestBody(draft, newer, [1, 2]).revision, 9);
  assert.equal(eventRequestBody(draft, undefined, [1, 2]).revision, 3);
});

test("saved events are added or replaced in programme order", () => {
  const dinner = voteEvent({ id: 1, startsAt: "2026-07-01T19:00:00Z" });
  const undated = voteEvent({ id: 2, startsAt: null });
  const aperitif = voteEvent({ id: 3, startsAt: "2026-07-01T17:00:00Z" });
  assert.deepEqual(
    withSavedEvent([dinner, undated], aperitif).map((event) => event.id),
    [3, 1, 2],
  );
  const moved = { ...dinner, revision: 4, startsAt: "2026-07-01T16:00:00Z" };
  assert.deepEqual(
    withSavedEvent([aperitif, dinner, undated], moved).map((event) => event.id),
    [1, 3, 2],
  );
  const stale = { ...dinner, revision: 2, title: "Outdated" };
  assert.equal(
    withSavedEvent([dinner], stale)[0].title,
    dinner.title,
    "an older acknowledgement never replaces a newer event",
  );
});
