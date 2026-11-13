import test from "node:test";
import assert from "node:assert/strict";
import type { PartyEvent } from "../src/features/programme/contracts.ts";
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

const candidates = [
  { id: 1, name: "Alex", avatarUrl: null, active: true },
  { id: 2, name: "Sam", avatarUrl: null, active: true },
  { id: 3, name: "Robin", avatarUrl: null, active: true },
];

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
    vote: {
      question: "Who has the best costume?",
      status: "draft",
      allowSelfVote: false,
      candidates,
      myCandidateId: null,
      canVote: false,
      participationCount: 0,
      results: null,
    },
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
    candidateIds: [1, 2, 3],
    allowSelfVote: false,
  });
  const body = eventRequestBody(draft, event, [1, 2, 3]);
  assert.equal(body.startsAt, "2026-07-01T18:30:00.000Z");
  assert.equal(body.unlockAt, null);
  assert.equal(body.revision, 3);

  const fresh = newEventDraft("vote");
  assert.deepEqual(fresh.vote, {
    question: "",
    candidateIds: [],
    allowSelfVote: false,
  });
  assert.equal(newEventDraft("questions", "Sans filtre").title, "Sans filtre");
  assert.equal(newEventDraft("event").vote, null);
  assert.equal("revision" in eventRequestBody(fresh, undefined, []), false);
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
    "invalid_event",
  );
  assert.equal(draftProblem(draft, null, [1]), "invalid_activity");
  assert.equal(
    draftProblem(
      draft,
      null,
      Array.from({ length: 201 }, (_, index) => index + 1),
    ),
    "invalid_activity",
  );
  assert.equal(
    draftProblem(
      { ...draft, vote: { ...draft.vote!, question: " " } },
      null,
      [1, 2],
    ),
    "invalid_activity",
  );
  assert.equal(draftProblem({ ...draft, vote: null }, null, []), null);

  // An opened vote keeps its candidates, including guests who left since.
  const open = voteEvent({ vote: { ...event.vote!, status: "open" } });
  assert.equal(frozenVote(event), null);
  assert.equal(frozenVote(open), open.vote);
  assert.equal(draftProblem(draft, frozenVote(open), [1]), null);
  const body = eventRequestBody(
    {
      ...draft,
      title: " Best costume ",
      vote: { question: " Who? ", candidateIds: [1], allowSelfVote: true },
    },
    open,
    [1],
  );
  assert.equal(body.title, "Best costume");
  assert.deepEqual(body.vote, {
    question: "Who?",
    candidateIds: [1, 2, 3],
    allowSelfVote: false,
  });
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
