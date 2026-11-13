import test from "node:test";
import assert from "node:assert/strict";
import {
  eventSchema,
  questionRoundSchema,
  voteSchema,
  type PartyEvent,
  type Vote,
  type VoteOption,
} from "../src/features/programme/contracts.ts";
import {
  choiceKey,
  isReadableVote,
  leadingVotes,
  optionObstacle,
  pendingChoice,
  replaceEvent,
  totalVotes,
  voteTransitions,
} from "../src/features/programme/vote-model.ts";

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

const alex = option({
  id: 10,
  label: "Alex",
  guestId: 1,
  avatarUrl: "/api/guests/1/avatar?v=2",
  votes: 4,
});
const sam = option({ id: 11, label: "Sam", guestId: 2, votes: 4 });
const robin = option({ id: 12, label: "Robin", guestId: 3, active: false });

const vote: Vote = {
  question: "Who has the best costume?",
  status: "open",
  choices: "guests",
  allowSelfVote: false,
  allowWriteIns: false,
  options: [alex, sam, robin],
  myOptionId: 11,
  canVote: true,
};

const pizza = option({ id: 20, label: "Pizza", votes: 2 });
const crepes = option({ id: 21, label: "Crêpes", writeIn: true, votes: 1 });

const customVote: Vote = {
  question: "What do we eat at midnight?",
  status: "open",
  choices: "custom",
  allowSelfVote: false,
  allowWriteIns: true,
  options: [pizza, crepes],
  myOptionId: null,
  canVote: true,
};

const event: PartyEvent = {
  id: 10,
  type: "vote",
  revision: 1,
  title: "Costumes",
  description: "Choose your favorite costume.",
  teaser: "A vote after dinner",
  startsAt: null,
  unlockAt: null,
  locked: false,
  vote,
};

test("programme events support typed settings and redacted or administrator views of locked votes", () => {
  assert.deepEqual(eventSchema.parse(event), event);
  const ordinary = { ...event, type: "event", vote: null };
  assert.deepEqual(eventSchema.parse(ordinary), ordinary);
  const locked = { ...event, locked: true, vote: null, description: "" };
  assert.deepEqual(eventSchema.parse(locked), locked);
  const lockedAdmin = { ...event, locked: true };
  assert.deepEqual(eventSchema.parse(lockedAdmin), lockedAdmin);
  for (const invalid of [
    { ...event, type: "unknown" },
    { ...event, type: "event" },
    { ...event, revision: 0 },
    { ...event, vote: null },
    { ...event, type: undefined },
  ])
    assert.equal(eventSchema.safeParse(invalid).success, false);
});

test("votes validate their options, portraits and the viewer's own choice", () => {
  assert.deepEqual(voteSchema.parse(vote), vote);
  assert.deepEqual(voteSchema.parse(customVote), customVote);
  // The forms and Go hold the ceilings; a response is not limited by them.
  const many = Array.from({ length: 201 }, (_, index) =>
    option({ id: index + 1, label: "x".repeat(81) }),
  );
  for (const valid of [
    { ...vote, question: "x".repeat(241) },
    { ...customVote, options: many },
    // A vote that guests fill themselves starts without any choice.
    { ...customVote, options: [] },
    { ...vote, status: "closed", canVote: false },
    { ...vote, status: "draft", canVote: false, myOptionId: null },
  ])
    assert.equal(voteSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...vote, question: "" },
    { ...vote, options: [alex, alex], myOptionId: null },
    { ...vote, options: [{ ...alex, label: "" }, sam] },
    { ...vote, options: [{ ...alex, votes: -1 }, sam] },
    {
      ...vote,
      options: [
        { ...alex, avatarUrl: "https://example.com/portrait.jpg" },
        sam,
      ],
    },
    { ...vote, myOptionId: 99 },
    { ...vote, status: "closed" },
    { ...vote, status: "revealed", canVote: false },
    { ...vote, choices: "anything" },
    // The source decides what an option is.
    { ...vote, options: [alex, pizza], myOptionId: null },
    { ...vote, options: [alex, { ...sam, writeIn: true }] },
    { ...customVote, options: [pizza, sam] },
  ])
    assert.equal(voteSchema.safeParse(invalid).success, false);
});

test("a vote response keeps nothing beyond counts and the viewer's own choice", () => {
  const parsed = voteSchema.parse({
    ...vote,
    voters: [{ guestId: 5, optionId: 10 }],
    options: [{ ...alex, voterIds: [5] }, sam],
  });
  assert.deepEqual(parsed, { ...vote, options: [alex, sam] });
});

test("totals and the leading count follow the options, ties included", () => {
  assert.equal(totalVotes(vote), 8);
  assert.equal(leadingVotes(vote), 4);
  assert.equal(totalVotes(customVote), 3);
  assert.equal(leadingVotes(customVote), 2);
  const unanswered = { ...customVote, options: [] };
  assert.equal(totalVotes(unanswered), 0);
  assert.equal(leadingVotes(unanswered), 0);
  const leaders = vote.options.filter(
    (item) => item.votes === leadingVotes(vote),
  );
  assert.deepEqual(
    leaders.map((item) => item.label),
    ["Alex", "Sam"],
  );
});

test("a guest cannot choose a revoked guest, nor themselves unless the host allows it", () => {
  assert.equal(optionObstacle(vote, alex, 2), null);
  assert.equal(optionObstacle(vote, sam, 2), "self");
  assert.equal(optionObstacle(vote, robin, 2), "inactive");
  assert.equal(optionObstacle(vote, robin, 3), "inactive");
  assert.equal(optionObstacle({ ...vote, allowSelfVote: true }, sam, 2), null);
  // Custom choices stand for nobody.
  assert.equal(optionObstacle(customVote, pizza, 2), null);
});

test("an unsent pick survives live updates until its option leaves or closes to the viewer", () => {
  assert.deepEqual(pendingChoice(vote, null, 9), { option: null, lost: false });
  assert.deepEqual(pendingChoice(vote, 10, 9), { option: alex, lost: false });

  // Another guest's vote reorders the list and changes the counts.
  const busier = { ...alex, votes: 2 };
  const reordered = { ...vote, options: [sam, busier, robin] };
  assert.deepEqual(pendingChoice(reordered, 10, 9), {
    option: busier,
    lost: false,
  });

  const lost = { option: null, lost: true };
  // The host removed the write-in the guest had picked.
  assert.deepEqual(
    pendingChoice({ ...customVote, options: [pizza] }, 21, 9),
    lost,
  );
  // The guest behind the option lost access.
  const revoked = { ...vote, options: [{ ...alex, active: false }, sam] };
  assert.deepEqual(pendingChoice(revoked, 10, 9), lost);
  assert.deepEqual(pendingChoice(vote, 11, 2), lost);
});

test("late ballot acknowledgements cannot reopen a vote or overwrite newer event details", () => {
  const closed = eventSchema.parse({
    ...event,
    title: "Updated costumes",
    revision: 2,
    vote: { ...vote, status: "closed", canVote: false },
  });
  const unchanged = replaceEvent([closed], event)[0];
  assert.equal(unchanged.vote?.status, "closed");
  assert.equal(unchanged.title, "Updated costumes");
  const accepted = {
    ...closed,
    vote: { ...closed.vote!, myOptionId: 10 },
  };
  assert.equal(replaceEvent([closed], accepted)[0].vote?.myOptionId, 10);
  assert.equal(closed.vote?.myOptionId, 11);
  assert.deepEqual(replaceEvent([], accepted), []);
});

test("a vote page shows unlocked vote events only", () => {
  assert.equal(isReadableVote(event), true);
  assert.equal(isReadableVote(undefined), false);
  assert.equal(isReadableVote({ ...event, locked: true, vote: null }), false);
  // A host's list still carries the details of a locked vote.
  assert.equal(isReadableVote({ ...event, locked: true }), false);
  assert.equal(isReadableVote({ ...event, type: "event", vote: null }), false);
});

test("a vote opens, then closes, with nothing left to reveal", () => {
  assert.equal(voteTransitions.draft.status, "open");
  assert.equal(voteTransitions.open.status, "closed");
  assert.deepEqual(Object.keys(voteTransitions), ["draft", "open"]);
});

test("custom choices are compared without case or outer spaces", () => {
  assert.equal(choiceKey("  Pizza "), choiceKey("pizza"));
  assert.equal(choiceKey("CRÊPES"), choiceKey("crêpes"));
  assert.notEqual(choiceKey("Pizza"), choiceKey("Pizzas"));
  assert.equal(choiceKey("   "), "");
});

test("question rounds keep the two-joker budget without frontend ceilings", () => {
  const question = {
    id: 1,
    body: "x".repeat(1001),
    status: "pending",
    votes: 3,
    upvoted: false,
  };
  const round = {
    status: "open",
    jokersUsed: 2,
    questionCount: 201,
    revision: 4,
    items: Array(201).fill(question),
  };
  assert.equal(questionRoundSchema.safeParse(round).success, true);
  for (const invalid of [
    { ...round, jokersUsed: 3 },
    { ...round, jokersUsed: -1 },
    { ...round, questionCount: -1 },
    { ...round, status: "revealed" },
    { ...round, items: [{ ...question, body: "" }] },
    { ...round, items: [{ ...question, status: "skipped" }] },
  ])
    assert.equal(questionRoundSchema.safeParse(invalid).success, false);
});
